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
        Image: {
          'Fn::Join': Match.arrayWith([
            Match.arrayWith([
              Match.stringLikeRegexp('dkr\\.ecr'),
            ]),
          ]),
        },
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
