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
