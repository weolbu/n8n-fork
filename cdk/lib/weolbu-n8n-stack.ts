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
