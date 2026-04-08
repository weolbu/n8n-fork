import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Template } from 'aws-cdk-lib/assertions';
import { DnsConstruct } from '../lib/constructs/dns';

let template: Template;

beforeAll(() => {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'TestStack', {
    env: { account: '123456789012', region: 'ap-northeast-2' },
  });

  const vpc = new ec2.Vpc(stack, 'TestVpc', { maxAzs: 2 });
  const alb = new elbv2.ApplicationLoadBalancer(stack, 'TestAlb', {
    vpc,
    internetFacing: true,
  });
  const hostedZone = new route53.HostedZone(stack, 'TestZone', {
    zoneName: 'weolbu.com',
  });

  new DnsConstruct(stack, 'Dns', {
    alb,
    hostedZone,
    domainName: 'n8n2.weolbu.com',
  });

  template = Template.fromStack(stack);
});

test('creates A record as ALB alias', () => {
  template.hasResourceProperties('AWS::Route53::RecordSet', {
    Name: 'n8n2.weolbu.com.',
    Type: 'A',
  });
});
