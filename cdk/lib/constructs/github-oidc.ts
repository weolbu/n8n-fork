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
    const region = cdk.Stack.of(this).region;
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
      ],
      resources: [
        props.ecsClusterArn,
        props.ecsServiceArn,
      ],
    }));

    this.deployRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ecs:DescribeTaskDefinition',
        'ecs:RegisterTaskDefinition',
      ],
      resources: ['*'],
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

    const output = new cdk.CfnOutput(this, 'DeployRoleArn', {
      exportName: 'GitHubOidcDeployRoleArn',
      value: this.deployRole.roleArn,
      description: 'GitHub Actions deploy role ARN',
    });
    output.overrideLogicalId('GitHubOidcDeployRoleArn');
  }
}
