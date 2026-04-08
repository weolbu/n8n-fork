import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
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
  ecrRepository: ecr.IRepository;
  imageTag: string;
}

export class EcsServiceConstruct extends Construct {
  public readonly service: ecs.FargateService;

  constructor(scope: Construct, id: string, props: EcsServiceConstructProps) {
    super(scope, id);

    // CloudWatch Log Group
    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: '/ecs/weolbu-n8n',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Explicit IAM roles
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

    // Task Definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      family: 'weolbu-n8n',
      cpu: 1024,
      memoryLimitMiB: 2048,
      taskRole,
      executionRole,
    });

    // Secrets Manager references
    const encryptionKey = secretsmanager.Secret.fromSecretNameV2(
      this, 'EncryptionKey', 'n8n/prod/encryption-key',
    );
    const dbPassword = secretsmanager.Secret.fromSecretNameV2(
      this, 'DbPassword', 'n8n/prod/db-password',
    );
    // Grant read access to execution role
    encryptionKey.grantRead(executionRole);
    dbPassword.grantRead(executionRole);
    props.ecrRepository.grantPull(executionRole);

    // Container
    taskDefinition.addContainer('N8nContainer', {
      image: ecs.ContainerImage.fromEcrRepository(props.ecrRepository, props.imageTag),
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

    // Fargate Service
    this.service = new ecs.FargateService(this, 'Service', {
      cluster: props.cluster,
      taskDefinition,
      desiredCount: 1,
      serviceName: 'weolbu-n8n-service',
      securityGroups: [props.ecsSecurityGroup],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      assignPublicIp: false,
    });

    // Attach to target group
    this.service.attachToApplicationTargetGroup(props.targetGroup);
  }
}
