# n8n ECR 배포 파이프라인 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** n8n-fork의 커스텀 Docker 이미지를 ECR에 push하고 GitHub Actions로 ECS에 배포하는 파이프라인 구축

**Architecture:** 기존 weolbu-n8n CDK 프로젝트를 n8n-fork로 이관하고, ECR 레포지토리 + GitHub OIDC IAM Role construct를 추가한다. GitHub Actions 워크플로우 2개 (자동 태그 + 수동 배포)를 추가하고, ECS 이미지 소스를 ECR로 전환한다.

**Tech Stack:** AWS CDK (TypeScript), GitHub Actions, Docker, ECR, ECS Fargate, OIDC

**Spec:** `docs/superpowers/specs/2026-04-08-ecr-deploy-pipeline-design.md`

---

## File Structure

### CDK (weolbu-n8n에서 이관 + 신규)

| File | Action | Responsibility |
|------|--------|----------------|
| `cdk/bin/app.ts` | Copy | CDK app entrypoint |
| `cdk/lib/weolbu-n8n-stack.ts` | Copy+Modify | 메인 스택 — ECR, OIDC construct 연결 추가 |
| `cdk/lib/constructs/networking.ts` | Copy | ALB, SG, Target Group (변경 없음) |
| `cdk/lib/constructs/dns.ts` | Copy | Route53 A 레코드 (변경 없음) |
| `cdk/lib/constructs/ecs-service.ts` | Copy+Modify | 이미지 소스를 ECR로 변경 |
| `cdk/lib/constructs/ecr.ts` | Create | ECR 레포지토리 + lifecycle policy |
| `cdk/lib/constructs/github-oidc.ts` | Create | OIDC IAM Role |
| `cdk/test/ecr.test.ts` | Create | ECR construct 테스트 |
| `cdk/test/github-oidc.test.ts` | Create | OIDC construct 테스트 |
| `cdk/test/ecs-service.test.ts` | Copy+Modify | 이미지 소스 변경 반영 |
| `cdk/test/networking.test.ts` | Copy | 변경 없음 |
| `cdk/test/dns.test.ts` | Copy | 변경 없음 |
| `cdk/package.json` | Copy | CDK 의존성 |
| `cdk/tsconfig.json` | Copy | TypeScript 설정 |
| `cdk/cdk.json` | Copy+Modify | ECR/OIDC context 추가 |
| `cdk/.gitignore` | Copy | CDK gitignore |

### GitHub Actions (신규)

| File | Action | Responsibility |
|------|--------|----------------|
| `.github/workflows/weolbu-tag-on-merge.yml` | Create | PR→main 병합 시 자동 태그 |
| `.github/workflows/weolbu-deploy.yml` | Create | 수동 빌드/push/배포 |

---

## Task 1: CDK 프로젝트 이관 (기존 파일 복사)

weolbu-n8n의 CDK 코드를 n8n-fork로 그대로 복사한다. 이 단계에서는 코드 변경 없이 복사만 한다.

**Files:**
- Create: `cdk/bin/app.ts`
- Create: `cdk/lib/weolbu-n8n-stack.ts`
- Create: `cdk/lib/constructs/networking.ts`
- Create: `cdk/lib/constructs/ecs-service.ts`
- Create: `cdk/lib/constructs/dns.ts`
- Create: `cdk/test/dns.test.ts`
- Create: `cdk/test/ecs-service.test.ts`
- Create: `cdk/test/networking.test.ts`
- Create: `cdk/package.json`
- Create: `cdk/tsconfig.json`
- Create: `cdk/cdk.json`
- Create: `cdk/.gitignore`

- [ ] **Step 1: CDK 디렉토리 구조 생성 및 파일 복사**

```bash
cd /Users/awesome/git/n8n-fork
mkdir -p cdk/bin cdk/lib/constructs cdk/test
```

다음 파일들을 weolbu-n8n에서 복사:

`cdk/.gitignore`:
```
node_modules/
dist/
*.js
*.d.ts
!jest.config.js
cdk.out/
```

`cdk/package.json`:
```json
{
  "name": "weolbu-n8n-cdk",
  "version": "1.0.0",
  "scripts": {
    "build": "tsc",
    "test": "jest",
    "cdk": "cdk"
  },
  "devDependencies": {
    "@types/jest": "^29.5.0",
    "@types/node": "^20.0.0",
    "aws-cdk": "^2.180.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.0",
    "ts-node": "^10.9.0",
    "typescript": "~5.4.0"
  },
  "dependencies": {
    "aws-cdk-lib": "^2.180.0",
    "constructs": "^10.0.0"
  },
  "jest": {
    "testEnvironment": "node",
    "roots": ["<rootDir>/test"],
    "testMatch": ["**/*.test.ts"],
    "transform": {
      "^.+\\.tsx?$": "ts-jest"
    }
  }
}
```

`cdk/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["es2020"],
    "declaration": true,
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": false,
    "inlineSourceMap": true,
    "inlineSources": true,
    "experimentalDecorators": true,
    "strictPropertyInitialization": false,
    "outDir": "./dist",
    "rootDir": "."
  },
  "exclude": ["node_modules", "dist"]
}
```

`cdk/cdk.json`:
```json
{
  "app": "npx ts-node --prefer-ts-exts bin/app.ts",
  "context": {
    "vpcId": "vpc-0020001e2f75138b5",
    "ecsClusterName": "weolbu-prod-cluster",
    "acmCertificateArn": "arn:aws:acm:ap-northeast-2:299743443000:certificate/66546fe2-ac22-4157-a9e3-c9e9ab0fae0c",
    "hostedZoneId": "Z0608838CYLEF2I2BCIS",
    "hostedZoneName": "weolbu.com",
    "domainName": "n8n.weolbu.com",
    "rdsEndpoint": "redash-prod.ccddem2fvgjp.ap-northeast-2.rds.amazonaws.com",
    "rdsSecurityGroupId": "sg-06ffd1a365847c1f9",
    "allowedCidrs": [
      "221.151.188.17/32",
      "13.124.43.252/32",
      "3.36.140.52/32"
    ]
  }
}
```

`cdk/bin/app.ts`:
```typescript
#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { WeolbuN8nStack } from '../lib/weolbu-n8n-stack';

const app = new cdk.App();

new WeolbuN8nStack(app, 'WeolbuN8nStack', {
  env: {
    account: '299743443000',
    region: 'ap-northeast-2',
  },
});
```

`cdk/lib/constructs/networking.ts`:
```typescript
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';

export interface NetworkingConstructProps {
  vpc: ec2.IVpc;
  allowedCidrs: string[];
  certificateArn: string;
}

export class NetworkingConstruct extends Construct {
  public readonly alb: elbv2.ApplicationLoadBalancer;
  public readonly albSecurityGroup: ec2.SecurityGroup;
  public readonly ecsSecurityGroup: ec2.SecurityGroup;
  public readonly targetGroup: elbv2.ApplicationTargetGroup;
  public readonly listener: elbv2.ApplicationListener;

  constructor(scope: Construct, id: string, props: NetworkingConstructProps) {
    super(scope, id);

    this.albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
      vpc: props.vpc,
      securityGroupName: 'weolbu-prod-n8n-alb-sg',
      description: 'ALB Security Group for n8n',
      allowAllOutbound: false,
    });

    for (const cidr of props.allowedCidrs) {
      this.albSecurityGroup.addIngressRule(
        ec2.Peer.ipv4(cidr),
        ec2.Port.tcp(443),
        `Allow HTTPS from ${cidr}`,
      );
      this.albSecurityGroup.addIngressRule(
        ec2.Peer.ipv4(cidr),
        ec2.Port.tcp(80),
        `Allow HTTP from ${cidr} (redirect)`,
      );
    }

    this.ecsSecurityGroup = new ec2.SecurityGroup(this, 'EcsSecurityGroup', {
      vpc: props.vpc,
      securityGroupName: 'weolbu-prod-n8n-ecs-sg',
      description: 'ECS Security Group for n8n',
      allowAllOutbound: true,
    });

    this.ecsSecurityGroup.addIngressRule(
      this.albSecurityGroup,
      ec2.Port.tcp(5678),
      'Allow ALB to n8n container',
    );

    this.albSecurityGroup.addEgressRule(
      this.ecsSecurityGroup,
      ec2.Port.tcp(5678),
      'ALB to n8n ECS container',
    );

    this.alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc: props.vpc,
      internetFacing: true,
      securityGroup: this.albSecurityGroup,
      loadBalancerName: 'weolbu-prod-n8n-alb',
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    this.targetGroup = new elbv2.ApplicationTargetGroup(this, 'TargetGroup', {
      vpc: props.vpc,
      port: 5678,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      targetGroupName: 'weolbu-prod-n8n-tg',
      healthCheck: {
        path: '/healthz',
        port: '5678',
        healthyHttpCodes: '200',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
    });

    const certificate = acm.Certificate.fromCertificateArn(
      this,
      'Certificate',
      props.certificateArn,
    );

    this.listener = this.alb.addListener('HttpsListener', {
      port: 443,
      protocol: elbv2.ApplicationProtocol.HTTPS,
      certificates: [certificate],
      defaultTargetGroups: [this.targetGroup],
      open: false,
    });

    this.alb.addListener('HttpListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultAction: elbv2.ListenerAction.redirect({
        protocol: 'HTTPS',
        port: '443',
        permanent: true,
      }),
      open: false,
    });
  }
}
```

`cdk/lib/constructs/dns.ts`:
```typescript
import { Construct } from 'constructs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';

export interface DnsConstructProps {
  alb: elbv2.IApplicationLoadBalancer;
  hostedZone: route53.IHostedZone;
  domainName: string;
}

export class DnsConstruct extends Construct {
  constructor(scope: Construct, id: string, props: DnsConstructProps) {
    super(scope, id);

    new route53.ARecord(this, 'AliasRecord', {
      zone: props.hostedZone,
      recordName: props.domainName,
      target: route53.RecordTarget.fromAlias(
        new targets.LoadBalancerTarget(props.alb),
      ),
    });
  }
}
```

`cdk/lib/constructs/ecs-service.ts`:
```typescript
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

export interface EcsServiceConstructProps {
  vpc: ec2.IVpc;
  cluster: ecs.ICluster;
  ecsSecurityGroup: ec2.ISecurityGroup;
  targetGroup: elbv2.IApplicationTargetGroup;
  rdsEndpoint: string;
  domainName: string;
}

export class EcsServiceConstruct extends Construct {
  public readonly service: ecs.FargateService;

  constructor(scope: Construct, id: string, props: EcsServiceConstructProps) {
    super(scope, id);

    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: '/ecs/weolbu-n8n',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const taskRole = new iam.Role(this, 'TaskRole', {
      roleName: 'weolbu-n8n-task-role',
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    const executionRole = new iam.Role(this, 'ExecutionRole', {
      roleName: 'weolbu-n8n-execution-role',
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      family: 'weolbu-n8n',
      cpu: 1024,
      memoryLimitMiB: 2048,
      taskRole,
      executionRole,
    });

    const encryptionKey = secretsmanager.Secret.fromSecretNameV2(
      this, 'EncryptionKey', 'n8n/prod/encryption-key',
    );
    const dbPassword = secretsmanager.Secret.fromSecretNameV2(
      this, 'DbPassword', 'n8n/prod/db-password',
    );
    encryptionKey.grantRead(executionRole);
    dbPassword.grantRead(executionRole);

    taskDefinition.addContainer('N8nContainer', {
      image: ecs.ContainerImage.fromRegistry('n8nio/n8n:1.123.28'),
      containerName: 'n8n',
      portMappings: [{ containerPort: 5678 }],
      logging: ecs.LogDrivers.awsLogs({
        logGroup,
        streamPrefix: 'n8n',
      }),
      environment: {
        DB_TYPE: 'postgresdb',
        DB_POSTGRESDB_HOST: props.rdsEndpoint,
        DB_POSTGRESDB_PORT: '5432',
        DB_POSTGRESDB_DATABASE: 'n8n',
        DB_POSTGRESDB_USER: 'n8n',
        DB_POSTGRESDB_SSL_ENABLED: 'true',
        DB_POSTGRESDB_SSL_REJECT_UNAUTHORIZED: 'false',
        N8N_HOST: props.domainName,
        N8N_PORT: '5678',
        N8N_PROTOCOL: 'http',
        WEBHOOK_URL: `https://${props.domainName}/`,
        NODE_ENV: 'production',
        GENERIC_TIMEZONE: 'Asia/Seoul',
        TZ: 'Asia/Seoul',
        EXECUTIONS_DATA_PRUNE: 'true',
        EXECUTIONS_DATA_MAX_AGE: '168',
        N8N_BLOCK_ENV_ACCESS_IN_NODE: 'true',
        N8N_SECURE_COOKIE: 'true',
        N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS: 'false',
      },
      secrets: {
        N8N_ENCRYPTION_KEY: ecs.Secret.fromSecretsManager(encryptionKey),
        DB_POSTGRESDB_PASSWORD: ecs.Secret.fromSecretsManager(dbPassword),
      },
    });

    this.service = new ecs.FargateService(this, 'Service', {
      cluster: props.cluster,
      taskDefinition,
      desiredCount: 1,
      serviceName: 'weolbu-n8n-service',
      securityGroups: [props.ecsSecurityGroup],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      assignPublicIp: false,
    });

    this.service.attachToApplicationTargetGroup(props.targetGroup);
  }
}
```

`cdk/lib/weolbu-n8n-stack.ts`:
```typescript
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { NetworkingConstruct } from './constructs/networking';
import { EcsServiceConstruct } from './constructs/ecs-service';
import { DnsConstruct } from './constructs/dns';

export class WeolbuN8nStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpcId = this.node.tryGetContext('vpcId');
    const ecsClusterName = this.node.tryGetContext('ecsClusterName');
    const acmCertificateArn = this.node.tryGetContext('acmCertificateArn');
    const hostedZoneId = this.node.tryGetContext('hostedZoneId');
    const hostedZoneName = this.node.tryGetContext('hostedZoneName');
    const domainName = this.node.tryGetContext('domainName');
    const rdsEndpoint = this.node.tryGetContext('rdsEndpoint');
    const rdsSecurityGroupId = this.node.tryGetContext('rdsSecurityGroupId');
    const allowedCidrs = this.node.tryGetContext('allowedCidrs');

    const vpc = ec2.Vpc.fromLookup(this, 'Vpc', { vpcId });

    const cluster = ecs.Cluster.fromClusterAttributes(this, 'Cluster', {
      clusterName: ecsClusterName,
      vpc,
      securityGroups: [],
    });

    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
      hostedZoneId,
      zoneName: hostedZoneName,
    });

    const rdsSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
      this,
      'RdsSecurityGroup',
      rdsSecurityGroupId,
    );

    const networking = new NetworkingConstruct(this, 'Networking', {
      vpc,
      allowedCidrs,
      certificateArn: acmCertificateArn,
    });

    const ecsService = new EcsServiceConstruct(this, 'EcsService', {
      vpc,
      cluster,
      ecsSecurityGroup: networking.ecsSecurityGroup,
      targetGroup: networking.targetGroup,
      rdsEndpoint,
      domainName,
    });

    new DnsConstruct(this, 'Dns', {
      alb: networking.alb,
      hostedZone,
      domainName,
    });

    rdsSecurityGroup.addIngressRule(
      networking.ecsSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow n8n ECS to connect to RDS',
    );

    new cdk.CfnOutput(this, 'AlbDnsName', {
      value: networking.alb.loadBalancerDnsName,
      description: 'ALB DNS name for n8n',
    });

    new cdk.CfnOutput(this, 'N8nUrl', {
      value: `https://${domainName}`,
      description: 'n8n access URL',
    });

    new cdk.CfnOutput(this, 'EcsServiceName', {
      value: ecsService.service.serviceName,
      description: 'ECS service name for deployment updates',
    });
  }
}
```

테스트 파일 3개 (`cdk/test/dns.test.ts`, `cdk/test/ecs-service.test.ts`, `cdk/test/networking.test.ts`)도 weolbu-n8n에서 그대로 복사한다. (내용은 기존 weolbu-n8n/cdk/test/ 에서 복사 — 본문 생략, Task 2에서 수정할 ecs-service.test.ts만 후술)

- [ ] **Step 2: npm install 및 기존 테스트 통과 확인**

```bash
cd /Users/awesome/git/n8n-fork/cdk && npm install
```

```bash
cd /Users/awesome/git/n8n-fork/cdk && npm test
```

Expected: 모든 기존 테스트 PASS (3 test suites, 12 tests)

- [ ] **Step 3: 커밋**

```bash
cd /Users/awesome/git/n8n-fork
git add cdk/
git commit -m "chore: migrate CDK project from weolbu-n8n"
```

---

## Task 2: ECR Construct 추가

ECR 레포지토리를 생성하는 construct를 만든다.

**Files:**
- Create: `cdk/lib/constructs/ecr.ts`
- Create: `cdk/test/ecr.test.ts`

- [ ] **Step 1: ECR construct 테스트 작성**

`cdk/test/ecr.test.ts`:
```typescript
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { EcrConstruct } from '../lib/constructs/ecr';

let template: Template;

beforeAll(() => {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'TestStack', {
    env: { account: '123456789012', region: 'ap-northeast-2' },
  });

  new EcrConstruct(stack, 'Ecr', {
    repositoryName: 'weolbu/n8n',
  });

  template = Template.fromStack(stack);
});

test('creates ECR repository with correct name', () => {
  template.hasResourceProperties('AWS::ECR::Repository', {
    RepositoryName: 'weolbu/n8n',
  });
});

test('sets image tag mutability to MUTABLE', () => {
  template.hasResourceProperties('AWS::ECR::Repository', {
    ImageTagMutability: 'MUTABLE',
  });
});

test('sets lifecycle policy to keep last 10 images', () => {
  template.hasResourceProperties('AWS::ECR::Repository', {
    LifecyclePolicy: {
      LifecyclePolicyText: Match.stringLikeRegexp('"countNumber":10'),
    },
  });
});

test('sets removal policy to RETAIN', () => {
  const resources = template.findResources('AWS::ECR::Repository');
  const repoLogicalId = Object.keys(resources)[0];
  expect(resources[repoLogicalId].DeletionPolicy).toBe('Retain');
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
cd /Users/awesome/git/n8n-fork/cdk && npx jest test/ecr.test.ts --verbose
```

Expected: FAIL — `Cannot find module '../lib/constructs/ecr'`

- [ ] **Step 3: ECR construct 구현**

`cdk/lib/constructs/ecr.ts`:
```typescript
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ecr from 'aws-cdk-lib/aws-ecr';

export interface EcrConstructProps {
  repositoryName: string;
}

export class EcrConstruct extends Construct {
  public readonly repository: ecr.Repository;

  constructor(scope: Construct, id: string, props: EcrConstructProps) {
    super(scope, id);

    this.repository = new ecr.Repository(this, 'Repository', {
      repositoryName: props.repositoryName,
      imageScanOnPush: true,
      imageTagMutability: ecr.TagMutability.MUTABLE,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          description: 'Keep last 10 tagged images',
          maxImageCount: 10,
          rulePriority: 1,
          tagStatus: ecr.TagStatus.ANY,
        },
      ],
    });
  }
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
cd /Users/awesome/git/n8n-fork/cdk && npx jest test/ecr.test.ts --verbose
```

Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
cd /Users/awesome/git/n8n-fork
git add cdk/lib/constructs/ecr.ts cdk/test/ecr.test.ts
git commit -m "feat(cdk): add ECR repository construct"
```

---

## Task 3: GitHub OIDC IAM Role Construct 추가

GitHub Actions OIDC 인증용 IAM Role construct를 만든다.

**Files:**
- Create: `cdk/lib/constructs/github-oidc.ts`
- Create: `cdk/test/github-oidc.test.ts`

- [ ] **Step 1: OIDC construct 테스트 작성**

`cdk/test/github-oidc.test.ts`:
```typescript
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { GitHubOidcConstruct } from '../lib/constructs/github-oidc';

let template: Template;

beforeAll(() => {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'TestStack', {
    env: { account: '123456789012', region: 'ap-northeast-2' },
  });

  new GitHubOidcConstruct(stack, 'GitHubOidc', {
    githubOrg: 'weolbu',
    githubRepo: 'n8n-fork',
    ecrRepositoryArn: 'arn:aws:ecr:ap-northeast-2:123456789012:repository/weolbu/n8n',
    ecsClusterArn: `arn:aws:ecs:ap-northeast-2:123456789012:cluster/weolbu-prod-cluster`,
    ecsServiceArn: `arn:aws:ecs:ap-northeast-2:123456789012:service/weolbu-prod-cluster/weolbu-n8n-service`,
  });

  template = Template.fromStack(stack);
});

test('creates IAM role with GitHub OIDC trust policy', () => {
  template.hasResourceProperties('AWS::IAM::Role', {
    AssumeRolePolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({
          Action: 'sts:AssumeRoleWithWebIdentity',
          Condition: {
            StringEquals: {
              'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
            },
            StringLike: {
              'token.actions.githubusercontent.com:sub': 'repo:weolbu/n8n-fork:*',
            },
          },
          Effect: 'Allow',
        }),
      ]),
    },
  });
});

test('grants ECR push permissions', () => {
  template.hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({
          Action: Match.arrayWith([
            'ecr:BatchCheckLayerAvailability',
            'ecr:PutImage',
            'ecr:InitiateLayerUpload',
            'ecr:UploadLayerPart',
            'ecr:CompleteLayerUpload',
          ]),
          Effect: 'Allow',
        }),
      ]),
    },
  });
});

test('grants ECR GetAuthorizationToken', () => {
  template.hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({
          Action: 'ecr:GetAuthorizationToken',
          Effect: 'Allow',
          Resource: '*',
        }),
      ]),
    },
  });
});

test('grants ECS deploy permissions', () => {
  template.hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({
          Action: Match.arrayWith([
            'ecs:UpdateService',
            'ecs:DescribeServices',
            'ecs:DescribeTaskDefinition',
            'ecs:RegisterTaskDefinition',
          ]),
          Effect: 'Allow',
        }),
      ]),
    },
  });
});

test('grants IAM PassRole for ECS task roles', () => {
  template.hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({
          Action: 'iam:PassRole',
          Effect: 'Allow',
          Condition: {
            StringEquals: {
              'iam:PassedToService': 'ecs-tasks.amazonaws.com',
            },
          },
        }),
      ]),
    },
  });
});

test('outputs the role ARN', () => {
  template.hasOutput('GitHubOidcDeployRoleArn', {
    Value: Match.anyValue(),
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
cd /Users/awesome/git/n8n-fork/cdk && npx jest test/github-oidc.test.ts --verbose
```

Expected: FAIL — `Cannot find module '../lib/constructs/github-oidc'`

- [ ] **Step 3: OIDC construct 구현**

`cdk/lib/constructs/github-oidc.ts`:
```typescript
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface GitHubOidcConstructProps {
  githubOrg: string;
  githubRepo: string;
  ecrRepositoryArn: string;
  ecsClusterArn: string;
  ecsServiceArn: string;
}

export class GitHubOidcConstruct extends Construct {
  public readonly deployRole: iam.Role;

  constructor(scope: Construct, id: string, props: GitHubOidcConstructProps) {
    super(scope, id);

    const account = cdk.Stack.of(this).account;
    const oidcProviderArn = `arn:aws:iam::${account}:oidc-provider/token.actions.githubusercontent.com`;

    this.deployRole = new iam.Role(this, 'DeployRole', {
      roleName: 'weolbu-n8n-github-actions-role',
      assumedBy: new iam.FederatedPrincipal(
        oidcProviderArn,
        {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          },
          StringLike: {
            'token.actions.githubusercontent.com:sub': `repo:${props.githubOrg}/${props.githubRepo}:*`,
          },
        },
        'sts:AssumeRoleWithWebIdentity',
      ),
    });

    this.deployRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ecr:GetAuthorizationToken'],
      resources: ['*'],
    }));

    this.deployRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ecr:BatchCheckLayerAvailability',
        'ecr:PutImage',
        'ecr:InitiateLayerUpload',
        'ecr:UploadLayerPart',
        'ecr:CompleteLayerUpload',
        'ecr:BatchGetImage',
        'ecr:GetDownloadUrlForLayer',
      ],
      resources: [props.ecrRepositoryArn],
    }));

    this.deployRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ecs:UpdateService',
        'ecs:DescribeServices',
        'ecs:DescribeTaskDefinition',
        'ecs:RegisterTaskDefinition',
      ],
      resources: [
        props.ecsClusterArn,
        props.ecsServiceArn,
        `arn:aws:ecs:${cdk.Stack.of(this).region}:${account}:task-definition/weolbu-n8n:*`,
        `arn:aws:ecs:${cdk.Stack.of(this).region}:${account}:task-definition/weolbu-n8n`,
      ],
    }));

    this.deployRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['iam:PassRole'],
      resources: [
        `arn:aws:iam::${account}:role/weolbu-n8n-task-role`,
        `arn:aws:iam::${account}:role/weolbu-n8n-execution-role`,
      ],
      conditions: {
        StringEquals: {
          'iam:PassedToService': 'ecs-tasks.amazonaws.com',
        },
      },
    }));

    new cdk.CfnOutput(this, 'DeployRoleArn', {
      exportName: 'GitHubOidcDeployRoleArn',
      value: this.deployRole.roleArn,
      description: 'GitHub Actions deploy role ARN',
    });
  }
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
cd /Users/awesome/git/n8n-fork/cdk && npx jest test/github-oidc.test.ts --verbose
```

Expected: PASS (6 tests)

- [ ] **Step 5: 커밋**

```bash
cd /Users/awesome/git/n8n-fork
git add cdk/lib/constructs/github-oidc.ts cdk/test/github-oidc.test.ts
git commit -m "feat(cdk): add GitHub OIDC IAM role construct"
```

---

## Task 4: ECS 이미지 소스를 ECR로 변경

ecs-service.ts의 이미지 소스를 ECR 레포지토리에서 가져오도록 변경한다.

**Files:**
- Modify: `cdk/lib/constructs/ecs-service.ts`
- Modify: `cdk/test/ecs-service.test.ts`

- [ ] **Step 1: ecs-service 테스트 수정 — ECR 이미지 참조 검증**

`cdk/test/ecs-service.test.ts`에서 이미지 관련 테스트를 수정:

기존 테스트의 `beforeAll` 블록과 이미지 테스트를 변경한다.

`beforeAll` 블록에서 ECR repository를 생성하고 EcsServiceConstruct에 전달:

```typescript
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { EcsServiceConstruct } from '../lib/constructs/ecs-service';

let template: Template;

beforeAll(() => {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'TestStack', {
    env: { account: '123456789012', region: 'ap-northeast-2' },
  });

  const vpc = new ec2.Vpc(stack, 'TestVpc', { maxAzs: 2 });
  const cluster = new ecs.Cluster(stack, 'TestCluster', { vpc });
  const sg = new ec2.SecurityGroup(stack, 'TestSg', { vpc });
  const targetGroup = new elbv2.ApplicationTargetGroup(stack, 'TestTg', {
    vpc,
    port: 5678,
    protocol: elbv2.ApplicationProtocol.HTTP,
    targetType: elbv2.TargetType.IP,
  });
  const ecrRepository = new ecr.Repository(stack, 'TestEcr', {
    repositoryName: 'weolbu/n8n',
  });

  new EcsServiceConstruct(stack, 'EcsService', {
    vpc,
    cluster,
    ecsSecurityGroup: sg,
    targetGroup,
    rdsEndpoint: 'test-db.example.com',
    domainName: 'n8n2.weolbu.com',
    ecrRepository,
    imageTag: 'v2.16.0-weolbu.1',
  });

  template = Template.fromStack(stack);
});

test('creates Fargate service with desired count 1', () => {
  template.hasResourceProperties('AWS::ECS::Service', {
    DesiredCount: 1,
    LaunchType: 'FARGATE',
  });
});

test('creates task definition with correct CPU and memory', () => {
  template.hasResourceProperties('AWS::ECS::TaskDefinition', {
    Cpu: '1024',
    Memory: '2048',
    NetworkMode: 'awsvpc',
    RequiresCompatibilities: ['FARGATE'],
  });
});

test('creates container with ECR image and port 5678', () => {
  template.hasResourceProperties('AWS::ECS::TaskDefinition', {
    ContainerDefinitions: Match.arrayWith([
      Match.objectLike({
        Image: Match.objectLike({
          'Fn::Join': Match.arrayWith([
            Match.arrayWith([
              Match.stringLikeRegexp('dkr\\.ecr'),
            ]),
          ]),
        }),
        PortMappings: Match.arrayWith([
          Match.objectLike({ ContainerPort: 5678 }),
        ]),
      }),
    ]),
  });
});

test('creates container with required environment variables', () => {
  template.hasResourceProperties('AWS::ECS::TaskDefinition', {
    ContainerDefinitions: Match.arrayWith([
      Match.objectLike({
        Environment: Match.arrayWith([
          Match.objectLike({ Name: 'DB_TYPE', Value: 'postgresdb' }),
          Match.objectLike({ Name: 'N8N_HOST', Value: 'n8n2.weolbu.com' }),
          Match.objectLike({ Name: 'NODE_ENV', Value: 'production' }),
          Match.objectLike({ Name: 'GENERIC_TIMEZONE', Value: 'Asia/Seoul' }),
          Match.objectLike({ Name: 'N8N_BLOCK_ENV_ACCESS_IN_NODE', Value: 'true' }),
        ]),
      }),
    ]),
  });
});

test('creates container with secrets from Secrets Manager', () => {
  template.hasResourceProperties('AWS::ECS::TaskDefinition', {
    ContainerDefinitions: Match.arrayWith([
      Match.objectLike({
        Secrets: Match.arrayWith([
          Match.objectLike({ Name: 'N8N_ENCRYPTION_KEY' }),
          Match.objectLike({ Name: 'DB_POSTGRESDB_PASSWORD' }),
        ]),
      }),
    ]),
  });
});

test('creates CloudWatch log group', () => {
  template.hasResourceProperties('AWS::Logs::LogGroup', {
    LogGroupName: '/ecs/weolbu-n8n',
    RetentionInDays: 30,
  });
});

test('creates task execution role with Secrets Manager read permissions', () => {
  template.hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({
          Action: Match.arrayWith([
            'secretsmanager:GetSecretValue',
            'secretsmanager:DescribeSecret',
          ]),
          Effect: 'Allow',
        }),
      ]),
    },
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
cd /Users/awesome/git/n8n-fork/cdk && npx jest test/ecs-service.test.ts --verbose
```

Expected: FAIL — `ecrRepository` 프로퍼티가 EcsServiceConstructProps에 없음

- [ ] **Step 3: ecs-service.ts 수정 — ECR 이미지 소스 변경**

`cdk/lib/constructs/ecs-service.ts`의 props 인터페이스와 이미지 라인 변경:

인터페이스에 추가:
```typescript
import * as ecr from 'aws-cdk-lib/aws-ecr';

export interface EcsServiceConstructProps {
  vpc: ec2.IVpc;
  cluster: ecs.ICluster;
  ecsSecurityGroup: ec2.ISecurityGroup;
  targetGroup: elbv2.IApplicationTargetGroup;
  rdsEndpoint: string;
  domainName: string;
  ecrRepository: ecr.IRepository;
  imageTag: string;
}
```

컨테이너 이미지 변경:
```typescript
// Before:
image: ecs.ContainerImage.fromRegistry('n8nio/n8n:1.123.28'),

// After:
image: ecs.ContainerImage.fromEcrRepository(props.ecrRepository, props.imageTag),
```

ECR 읽기 권한 추가 (executionRole이 ECR에서 pull 가능하도록):
```typescript
props.ecrRepository.grantPull(executionRole);
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
cd /Users/awesome/git/n8n-fork/cdk && npx jest test/ecs-service.test.ts --verbose
```

Expected: PASS (7 tests)

- [ ] **Step 5: 커밋**

```bash
cd /Users/awesome/git/n8n-fork
git add cdk/lib/constructs/ecs-service.ts cdk/test/ecs-service.test.ts
git commit -m "feat(cdk): switch ECS image source from Docker Hub to ECR"
```

---

## Task 5: 메인 스택에 ECR + OIDC 연결

WeolbuN8nStack에서 ECR과 OIDC construct를 연결한다.

**Files:**
- Modify: `cdk/lib/weolbu-n8n-stack.ts`
- Modify: `cdk/cdk.json`

- [ ] **Step 1: cdk.json에 context 추가**

`cdk/cdk.json`의 `context`에 추가:
```json
{
  "context": {
    "ecrRepositoryName": "weolbu/n8n",
    "githubOrg": "weolbu",
    "githubRepo": "n8n-fork",
    "n8nImageTag": "latest"
  }
}
```

기존 context 값들은 유지하고, 위 4개를 추가한다.

- [ ] **Step 2: weolbu-n8n-stack.ts 수정**

ECR, OIDC construct를 import하고 연결:

```typescript
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { NetworkingConstruct } from './constructs/networking';
import { EcsServiceConstruct } from './constructs/ecs-service';
import { DnsConstruct } from './constructs/dns';
import { EcrConstruct } from './constructs/ecr';
import { GitHubOidcConstruct } from './constructs/github-oidc';

export class WeolbuN8nStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpcId = this.node.tryGetContext('vpcId');
    const ecsClusterName = this.node.tryGetContext('ecsClusterName');
    const acmCertificateArn = this.node.tryGetContext('acmCertificateArn');
    const hostedZoneId = this.node.tryGetContext('hostedZoneId');
    const hostedZoneName = this.node.tryGetContext('hostedZoneName');
    const domainName = this.node.tryGetContext('domainName');
    const rdsEndpoint = this.node.tryGetContext('rdsEndpoint');
    const rdsSecurityGroupId = this.node.tryGetContext('rdsSecurityGroupId');
    const allowedCidrs = this.node.tryGetContext('allowedCidrs');
    const ecrRepositoryName = this.node.tryGetContext('ecrRepositoryName');
    const githubOrg = this.node.tryGetContext('githubOrg');
    const githubRepo = this.node.tryGetContext('githubRepo');
    const n8nImageTag = this.node.tryGetContext('n8nImageTag');

    const vpc = ec2.Vpc.fromLookup(this, 'Vpc', { vpcId });

    const cluster = ecs.Cluster.fromClusterAttributes(this, 'Cluster', {
      clusterName: ecsClusterName,
      vpc,
      securityGroups: [],
    });

    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
      hostedZoneId,
      zoneName: hostedZoneName,
    });

    const rdsSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
      this,
      'RdsSecurityGroup',
      rdsSecurityGroupId,
    );

    // 1. ECR Repository
    const ecrConstruct = new EcrConstruct(this, 'Ecr', {
      repositoryName: ecrRepositoryName,
    });

    // 2. Networking (ALB, SG, TG)
    const networking = new NetworkingConstruct(this, 'Networking', {
      vpc,
      allowedCidrs,
      certificateArn: acmCertificateArn,
    });

    // 3. ECS Service
    const ecsService = new EcsServiceConstruct(this, 'EcsService', {
      vpc,
      cluster,
      ecsSecurityGroup: networking.ecsSecurityGroup,
      targetGroup: networking.targetGroup,
      rdsEndpoint,
      domainName,
      ecrRepository: ecrConstruct.repository,
      imageTag: n8nImageTag,
    });

    // 4. DNS
    new DnsConstruct(this, 'Dns', {
      alb: networking.alb,
      hostedZone,
      domainName,
    });

    // 5. GitHub OIDC
    new GitHubOidcConstruct(this, 'GitHubOidc', {
      githubOrg,
      githubRepo,
      ecrRepositoryArn: ecrConstruct.repository.repositoryArn,
      ecsClusterArn: `arn:aws:ecs:${this.region}:${this.account}:cluster/${ecsClusterName}`,
      ecsServiceArn: `arn:aws:ecs:${this.region}:${this.account}:service/${ecsClusterName}/weolbu-n8n-service`,
    });

    // 6. RDS Security Group
    rdsSecurityGroup.addIngressRule(
      networking.ecsSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow n8n ECS to connect to RDS',
    );

    // Outputs
    new cdk.CfnOutput(this, 'AlbDnsName', {
      value: networking.alb.loadBalancerDnsName,
      description: 'ALB DNS name for n8n',
    });

    new cdk.CfnOutput(this, 'N8nUrl', {
      value: `https://${domainName}`,
      description: 'n8n access URL',
    });

    new cdk.CfnOutput(this, 'EcsServiceName', {
      value: ecsService.service.serviceName,
      description: 'ECS service name for deployment updates',
    });

    new cdk.CfnOutput(this, 'EcrRepositoryUri', {
      value: ecrConstruct.repository.repositoryUri,
      description: 'ECR repository URI for Docker push',
    });
  }
}
```

- [ ] **Step 3: 전체 테스트 실행**

```bash
cd /Users/awesome/git/n8n-fork/cdk && npm test
```

Expected: 전체 테스트 PASS (5 test suites)

- [ ] **Step 4: 커밋**

```bash
cd /Users/awesome/git/n8n-fork
git add cdk/lib/weolbu-n8n-stack.ts cdk/cdk.json
git commit -m "feat(cdk): wire ECR and GitHub OIDC into main stack"
```

---

## Task 6: GitHub Actions — 자동 태그 워크플로우

PR이 main에 병합될 때 자동으로 버전 태그를 생성하는 워크플로우를 만든다.

**Files:**
- Create: `.github/workflows/weolbu-tag-on-merge.yml`

- [ ] **Step 1: 워크플로우 파일 작성**

`.github/workflows/weolbu-tag-on-merge.yml`:
```yaml
name: Auto Tag on Merge

on:
  push:
    branches: [main]

permissions:
  contents: write

jobs:
  tag:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Extract n8n version
        id: version
        run: |
          N8N_VERSION=$(jq -r '.version' packages/cli/package.json)
          echo "n8n_version=$N8N_VERSION" >> "$GITHUB_OUTPUT"
          echo "n8n version: $N8N_VERSION"

      - name: Calculate next weolbu tag number
        id: tag
        run: |
          N8N_VERSION="${{ steps.version.outputs.n8n_version }}"
          TAG_PREFIX="v${N8N_VERSION}-weolbu."

          # Find the highest existing weolbu number for this n8n version
          LAST_NUM=$(git tag -l "${TAG_PREFIX}*" | sed "s/${TAG_PREFIX}//" | sort -n | tail -1)

          if [ -z "$LAST_NUM" ]; then
            NEXT_NUM=1
          else
            NEXT_NUM=$((LAST_NUM + 1))
          fi

          NEW_TAG="${TAG_PREFIX}${NEXT_NUM}"
          echo "new_tag=$NEW_TAG" >> "$GITHUB_OUTPUT"
          echo "New tag: $NEW_TAG"

      - name: Create and push tag
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git tag -a "${{ steps.tag.outputs.new_tag }}" -m "Release ${{ steps.tag.outputs.new_tag }}"
          git push origin "${{ steps.tag.outputs.new_tag }}"
```

- [ ] **Step 2: YAML 문법 확인**

```bash
cd /Users/awesome/git/n8n-fork && python3 -c "import yaml; yaml.safe_load(open('.github/workflows/weolbu-tag-on-merge.yml'))" && echo "YAML valid"
```

Expected: `YAML valid`

- [ ] **Step 3: 커밋**

```bash
cd /Users/awesome/git/n8n-fork
git add .github/workflows/weolbu-tag-on-merge.yml
git commit -m "ci: add auto-tag workflow on merge to main"
```

---

## Task 7: GitHub Actions — 수동 배포 워크플로우

태그를 선택하여 빌드 → ECR push → ECS 배포하는 수동 워크플로우를 만든다.

**Files:**
- Create: `.github/workflows/weolbu-deploy.yml`

- [ ] **Step 1: 워크플로우 파일 작성**

`.github/workflows/weolbu-deploy.yml`:
```yaml
name: Deploy to ECS

on:
  workflow_dispatch:
    inputs:
      tag:
        description: 'Version tag to deploy (e.g. v2.16.0-weolbu.1)'
        required: true
        type: string

env:
  AWS_REGION: ap-northeast-2
  ECR_REPOSITORY: weolbu/n8n
  ECS_CLUSTER: weolbu-prod-cluster
  ECS_SERVICE: weolbu-n8n-service
  TASK_FAMILY: weolbu-n8n

permissions:
  id-token: write
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout tag
        uses: actions/checkout@v4
        with:
          ref: ${{ inputs.tag }}

      - name: Configure AWS credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}
          aws-region: ${{ env.AWS_REGION }}

      - name: Login to Amazon ECR
        id: ecr-login
        uses: aws-actions/amazon-ecr-login@v2

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 24

      - name: Install pnpm
        uses: pnpm/action-setup@v4

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build n8n and Docker image
        env:
          IMAGE_BASE_NAME: ${{ steps.ecr-login.outputs.registry }}/${{ env.ECR_REPOSITORY }}
          IMAGE_TAG: ${{ inputs.tag }}
        run: pnpm build:docker

      - name: Update ECS task definition and deploy
        run: |
          ECR_IMAGE="${{ steps.ecr-login.outputs.registry }}/${{ env.ECR_REPOSITORY }}:${{ inputs.tag }}"

          # Get current task definition
          TASK_DEF=$(aws ecs describe-task-definition \
            --task-definition "${{ env.TASK_FAMILY }}" \
            --query 'taskDefinition' \
            --output json)

          # Update image in container definitions
          NEW_TASK_DEF=$(echo "$TASK_DEF" | jq \
            --arg IMAGE "$ECR_IMAGE" \
            '.containerDefinitions[0].image = $IMAGE |
             del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities, .registeredAt, .registeredBy)')

          # Register new task definition revision
          NEW_REVISION=$(aws ecs register-task-definition \
            --cli-input-json "$NEW_TASK_DEF" \
            --query 'taskDefinition.taskDefinitionArn' \
            --output text)

          echo "New task definition: $NEW_REVISION"

          # Update ECS service with new task definition
          aws ecs update-service \
            --cluster "${{ env.ECS_CLUSTER }}" \
            --service "${{ env.ECS_SERVICE }}" \
            --task-definition "$NEW_REVISION"

          echo "Waiting for service to stabilize..."
          aws ecs wait services-stable \
            --cluster "${{ env.ECS_CLUSTER }}" \
            --services "${{ env.ECS_SERVICE }}"

          echo "Deployment complete: ${{ inputs.tag }}"
```

- [ ] **Step 2: YAML 문법 확인**

```bash
cd /Users/awesome/git/n8n-fork && python3 -c "import yaml; yaml.safe_load(open('.github/workflows/weolbu-deploy.yml'))" && echo "YAML valid"
```

Expected: `YAML valid`

- [ ] **Step 3: 커밋**

```bash
cd /Users/awesome/git/n8n-fork
git add .github/workflows/weolbu-deploy.yml
git commit -m "ci: add manual deploy workflow for ECR push and ECS update"
```

---

## Task 8: 전체 검증 및 최종 커밋

모든 CDK 테스트가 통과하는지 확인하고 마무리한다.

**Files:**
- 변경 없음 (검증만)

- [ ] **Step 1: CDK 전체 테스트**

```bash
cd /Users/awesome/git/n8n-fork/cdk && npm test
```

Expected: 5 test suites PASS (ecr, github-oidc, ecs-service, networking, dns)

- [ ] **Step 2: CDK synth 확인 (선택사항 — AWS credentials 필요)**

CDK synth는 VPC lookup 때문에 AWS credentials가 있어야 동작한다. credentials가 있으면:

```bash
cd /Users/awesome/git/n8n-fork/cdk && npx cdk synth 2>&1 | tail -20
```

credentials가 없으면 이 단계는 건너뛴다. 테스트만 통과하면 코드 수준의 검증은 완료.

- [ ] **Step 3: GitHub Actions YAML 문법 최종 확인**

```bash
cd /Users/awesome/git/n8n-fork
python3 -c "
import yaml
for f in ['.github/workflows/weolbu-tag-on-merge.yml', '.github/workflows/weolbu-deploy.yml']:
    yaml.safe_load(open(f))
    print(f'{f}: valid')
"
```

Expected:
```
.github/workflows/weolbu-tag-on-merge.yml: valid
.github/workflows/weolbu-deploy.yml: valid
```

- [ ] **Step 4: 파일 구조 최종 확인**

```bash
find cdk -type f -not -path '*/node_modules/*' -not -path '*/dist/*' -not -path '*/cdk.out/*' | sort
```

Expected:
```
cdk/.gitignore
cdk/bin/app.ts
cdk/cdk.json
cdk/lib/constructs/dns.ts
cdk/lib/constructs/ecr.ts
cdk/lib/constructs/ecs-service.ts
cdk/lib/constructs/github-oidc.ts
cdk/lib/constructs/networking.ts
cdk/lib/weolbu-n8n-stack.ts
cdk/package.json
cdk/test/dns.test.ts
cdk/test/ecr.test.ts
cdk/test/ecs-service.test.ts
cdk/test/github-oidc.test.ts
cdk/test/networking.test.ts
cdk/tsconfig.json
```

```bash
ls .github/workflows/weolbu-*.yml
```

Expected:
```
.github/workflows/weolbu-deploy.yml
.github/workflows/weolbu-tag-on-merge.yml
```

---

## 부트스트랩 순서 (구현 후 수동 작업)

구현 완료 후 실제 배포를 위한 수동 작업 순서:

1. **GitHub에서 master → main 브랜치 변경** (Settings → Default branch)
2. **로컬**: `git branch -m master main && git push -u origin main`
3. **CDK 배포**: `cd cdk && npm install && npx cdk deploy` (ECR + OIDC Role 생성)
4. **GitHub Secrets 등록**: `AWS_DEPLOY_ROLE_ARN` (CDK output에서 확인)
5. **첫 수동 배포 테스트**: GitHub Actions → Deploy to ECS → tag 입력 → 실행
6. **검증**: `curl -s https://n8n.weolbu.com/healthz`
