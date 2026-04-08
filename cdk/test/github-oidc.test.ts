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
    ecsClusterArn: 'arn:aws:ecs:ap-northeast-2:123456789012:cluster/weolbu-prod-cluster',
    ecsServiceArn: 'arn:aws:ecs:ap-northeast-2:123456789012:service/weolbu-prod-cluster/weolbu-n8n-service',
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
