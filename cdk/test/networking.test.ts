import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { NetworkingConstruct } from '../lib/constructs/networking';

let template: Template;

beforeAll(() => {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'TestStack', {
    env: { account: '123456789012', region: 'ap-northeast-2' },
  });

  const vpc = new ec2.Vpc(stack, 'TestVpc', { maxAzs: 2 });

  new NetworkingConstruct(stack, 'Networking', {
    vpc,
    allowedCidrs: ['221.151.188.17/32', '13.124.43.252/32', '3.36.140.52/32'],
    certificateArn: 'arn:aws:acm:ap-northeast-2:123456789012:certificate/test-cert-id',
  });

  template = Template.fromStack(stack);
});

test('creates ALB in public subnets', () => {
  template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
    Scheme: 'internet-facing',
    Type: 'application',
  });
});

test('creates ALB security group with allowed CIDRs only', () => {
  template.hasResourceProperties('AWS::EC2::SecurityGroup', {
    GroupDescription: Match.stringLikeRegexp('ALB'),
    SecurityGroupIngress: Match.arrayWith([
      Match.objectLike({
        IpProtocol: 'tcp',
        FromPort: 443,
        ToPort: 443,
        CidrIp: '221.151.188.17/32',
      }),
      Match.objectLike({
        IpProtocol: 'tcp',
        FromPort: 443,
        ToPort: 443,
        CidrIp: '13.124.43.252/32',
      }),
      Match.objectLike({
        IpProtocol: 'tcp',
        FromPort: 443,
        ToPort: 443,
        CidrIp: '3.36.140.52/32',
      }),
    ]),
  });
});

test('creates target group with health check on /healthz', () => {
  template.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
    Port: 5678,
    Protocol: 'HTTP',
    TargetType: 'ip',
    HealthCheckPath: '/healthz',
    HealthCheckPort: '5678',
  });
});

test('creates HTTPS listener on port 443', () => {
  template.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
    Port: 443,
    Protocol: 'HTTPS',
  });
});

test('creates HTTP to HTTPS redirect listener', () => {
  template.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
    Port: 80,
    Protocol: 'HTTP',
    DefaultActions: Match.arrayWith([
      Match.objectLike({
        Type: 'redirect',
        RedirectConfig: Match.objectLike({
          Protocol: 'HTTPS',
          StatusCode: 'HTTP_301',
        }),
      }),
    ]),
  });
});
