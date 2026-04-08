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

    // Context values
    const vpcId = this.node.tryGetContext('vpcId');
    const ecsClusterName = this.node.tryGetContext('ecsClusterName');
    const acmCertificateArn = this.node.tryGetContext('acmCertificateArn');
    const hostedZoneId = this.node.tryGetContext('hostedZoneId');
    const hostedZoneName = this.node.tryGetContext('hostedZoneName');
    const domainName = this.node.tryGetContext('domainName');
    const rdsEndpoint = this.node.tryGetContext('rdsEndpoint');
    const rdsSecurityGroupId = this.node.tryGetContext('rdsSecurityGroupId');
    const allowedCidrs = this.node.tryGetContext('allowedCidrs');

    // Lookup existing resources
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

    // 1. Networking (ALB, SG, TG)
    const networking = new NetworkingConstruct(this, 'Networking', {
      vpc,
      allowedCidrs,
      certificateArn: acmCertificateArn,
    });

    // 2. ECS Service
    const ecsService = new EcsServiceConstruct(this, 'EcsService', {
      vpc,
      cluster,
      ecsSecurityGroup: networking.ecsSecurityGroup,
      targetGroup: networking.targetGroup,
      rdsEndpoint,
      domainName,
    });

    // 3. DNS
    new DnsConstruct(this, 'Dns', {
      alb: networking.alb,
      hostedZone,
      domainName,
    });

    // 4. RDS Security Group — allow ECS to connect on 5432
    rdsSecurityGroup.addIngressRule(
      networking.ecsSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow n8n ECS to connect to RDS',
    );

    // Stack Outputs
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
