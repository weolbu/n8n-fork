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
