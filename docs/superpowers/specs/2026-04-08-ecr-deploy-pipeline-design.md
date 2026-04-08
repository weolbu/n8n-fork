# n8n 커스텀 Docker 이미지 ECR 배포 파이프라인 설계

## 개요

- **목적**: n8n-fork의 엔터프라이즈 패치가 적용된 커스텀 Docker 이미지를 빌드하여 ECR에 push하고, GitHub Actions를 통해 ECS Fargate에 배포하는 파이프라인 구축
- **레포**: `weolbu/n8n-fork` (기본 브랜치: `main`)
- **대상 환경**: 기존 ECS Fargate 서비스 (`weolbu-n8n-service`, `weolbu-prod-cluster`)
- **인증**: GitHub Actions OIDC → AWS IAM Role (Access Key 불필요)

## 아키텍처

```
PR → main 병합
  → tag-on-merge.yml: 자동 버전 태그 생성 (v{n8n버전}-weolbu.{번호})

수동 dispatch (태그 선택)
  → deploy.yml:
    → checkout 태그
    → OIDC AWS 인증
    → pnpm install + pnpm build:docker
    → docker push → ECR (weolbu/n8n)
    → ECS force new deployment
```

```
Internet → Route 53 (n8n.weolbu.com)
  → ALB (HTTPS:443, IP 제한)
    → ECS Fargate (커스텀 이미지 from ECR)
      → RDS PostgreSQL (redash-prod, DB: n8n)
```

## 변경사항 요약

### 기존 → 변경

| 항목 | Before | After |
|------|--------|-------|
| 이미지 소스 | `n8nio/n8n:1.123.28` (Docker Hub) | `{account}.dkr.ecr.ap-northeast-2.amazonaws.com/weolbu/n8n:{tag}` |
| CDK 위치 | `~/git/weolbu-n8n/cdk/` (별도 레포) | `~/git/n8n-fork/cdk/` (앱 코드와 동일 레포) |
| 배포 방식 | `cdk deploy` (이미지 태그 수동 변경) | GitHub Actions 수동 dispatch → 빌드/push/배포 |
| 기본 브랜치 | `master` | `main` |

## CDK 스택 구조

```
cdk/
├── bin/app.ts
├── lib/
│   ├── weolbu-n8n-stack.ts          ← 기존 + ECR/OIDC construct 연결
│   └── constructs/
│       ├── networking.ts            ← 기존 유지
│       ├── ecs-service.ts           ← 이미지 소스 ECR로 변경
│       ├── dns.ts                   ← 기존 유지
│       ├── ecr.ts                   ← 신규: ECR 레포지토리
│       └── github-oidc.ts           ← 신규: OIDC IAM Role
├── cdk.json
├── package.json
└── tsconfig.json
```

### 신규 construct: `ecr.ts`

ECR 레포지토리 생성:
- 레포지토리 이름: `weolbu/n8n`
- 이미지 수명주기 정책: 최근 10개 태그 유지 (오래된 이미지 자동 삭제)
- `removalPolicy: RETAIN` (스택 삭제 시 이미지 보존)

### 신규 construct: `github-oidc.ts`

GitHub Actions OIDC 인증용 IAM Role:
- 기존 OIDC Provider lookup (새로 생성하지 않음):
  `arn:aws:iam::{account}:oidc-provider/token.actions.githubusercontent.com`
- IAM Role trust policy: `repo:weolbu/n8n-fork:*`
- 권한:
  - ECR: `GetAuthorizationToken`, `BatchCheckLayerAvailability`, `PutImage`, `InitiateLayerUpload`, `UploadLayerPart`, `CompleteLayerUpload`
  - ECS: `UpdateService`, `DescribeServices`, `DescribeTaskDefinition`, `RegisterTaskDefinition`
  - IAM: `PassRole` (ECS task role, execution role에 대해)

### 변경 construct: `ecs-service.ts`

```typescript
// Before
image: ecs.ContainerImage.fromRegistry('n8nio/n8n:1.123.28')

// After
image: ecs.ContainerImage.fromEcrRepository(ecrRepository, imageTag)
```

- `imageTag`는 cdk.json context에서 기본값 제공 (최초 배포용)
- 이후 실제 이미지 태그 업데이트는 GitHub Actions에서 ECS force new deployment로 처리

### cdk.json 추가 context

```json
{
  "ecrRepositoryName": "weolbu/n8n",
  "githubOrg": "weolbu",
  "githubRepo": "n8n-fork",
  "n8nImageTag": "latest"
}
```

## GitHub Actions 워크플로우

### `tag-on-merge.yml` — PR 병합 시 자동 태그

- **trigger**: `push` to `main`
- **동작**:
  1. `packages/cli/package.json`에서 n8n 버전 추출
  2. 기존 태그에서 동일 n8n 버전의 마지막 weolbu 번호 조회
  3. 번호 +1로 새 태그 생성 및 push
- **태그 형식**: `v{n8n버전}-weolbu.{번호}`
- **예시**: `v1.123.28-weolbu.1`, `v1.123.28-weolbu.2`, `v1.124.0-weolbu.1`

### `deploy.yml` — 수동 배포

- **trigger**: `workflow_dispatch`
- **inputs**:
  - `tag` (required): 배포할 버전 태그
- **동작**:
  1. 해당 태그로 checkout
  2. OIDC로 AWS 인증 (`aws-actions/configure-aws-credentials`)
  3. ECR 로그인 (`aws-actions/amazon-ecr-login`)
  4. Node.js + pnpm 설정
  5. `pnpm install`
  6. `pnpm build:docker` (환경변수: `IMAGE_BASE_NAME={ecr-uri}`, `IMAGE_TAG={tag}`)
  7. 이미지 push (dockerize-n8n.mjs가 registry 감지 시 자동 push)
  8. 현재 태스크 정의를 조회하여 이미지 태그만 교체한 새 revision 등록
  9. `aws ecs update-service --task-definition {new-revision}` 으로 서비스 업데이트
- **ECS 배포 상세**:
  - `force-new-deployment`만으로는 이미지 태그가 변경되지 않음
  - 태스크 정의의 새 revision을 등록해야 ECS가 새 이미지를 pull함
  - 배포 후 `aws ecs wait services-stable`로 안정화 대기
- **GitHub Secrets 필요**:
  - `AWS_DEPLOY_ROLE_ARN` (CDK 배포 후 output에서 확인)

## 버전 태그 전략

```
n8n 버전: 1.123.28 (packages/cli/package.json)
기존 태그 없음       → v1.123.28-weolbu.1
패치 추가 후 병합    → v1.123.28-weolbu.2
upstream 머지 후     → v1.124.0-weolbu.1
```

- n8n 기반 버전이 변경되면 weolbu 번호는 1로 리셋
- 동일 n8n 버전에서 패치/설정 변경 시 번호 증가

## 브랜치 마이그레이션: master → main

1. GitHub에서 default branch를 `main`으로 변경
2. 로컬: `git branch -m master main && git push -u origin main`
3. Branch protection rule을 `main`으로 이동
4. 기존 `master` 브랜치 삭제
5. upstream 머지 시: `git fetch upstream master && git merge upstream/master` (브랜치명 달라도 문제없음)

## 초기 배포 순서 (부트스트랩)

```
Step 1: CDK에 ECR + OIDC IAM Role 추가 → cdk deploy (로컬에서 수동)
        → ECR 레포지토리 생성됨
        → IAM Role 생성됨 (Role ARN 확보)

Step 2: GitHub repo settings에 Secrets 등록
        → AWS_ACCOUNT_ID
        → AWS_DEPLOY_ROLE_ARN (Step 1에서 생성된 Role ARN)

Step 3: main 브랜치 변경 + GitHub Actions 워크플로우 push

Step 4: 첫 배포 테스트
        → 수동으로 deploy.yml 실행
        → ECR에 이미지 올라가는지 확인
        → ECS 서비스가 새 이미지로 뜨는지 확인

Step 5: CDK에서 ECS 이미지 소스를 ECR로 변경 → cdk deploy
        → 이후부터는 GitHub Actions로만 배포
```

Step 4와 Step 5가 분리된 이유: ECR에 이미지가 없는 상태에서 ECS가 ECR을 참조하면 태스크 시작이 실패합니다. 먼저 이미지를 push한 뒤 ECS 이미지 소스를 전환합니다.

## 월 추가 비용

| 항목 | 예상 비용 |
|------|-----------|
| ECR (이미지 10개 × ~500MB) | ~$0.50 |
| GitHub Actions (월 5회 빌드 × 20분) | 무료 (public repo) 또는 ~$1 |
| **추가 합계** | **~$1.50/월** |

기존 인프라 비용 (~$59/월)에 거의 영향 없음.
