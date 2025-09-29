# Project Starter

This is the starter template for ElizaOS projects.

## Features

- Pre-configured project structure for ElizaOS development
- Comprehensive testing setup with component and e2e tests
- Default character configuration with plugin integration
- Example service, action, and provider implementations
- TypeScript configuration for optimal developer experience
- Built-in documentation and examples

## Getting Started

```bash
# Create a new project
elizaos create -t project my-project
# Dependencies are automatically installed and built

# Navigate to the project directory
cd my-project

# Start development immediately
elizaos dev
```

## X Agent: Onchain Koi

- 基础功能：
  - 爬取站点（`CRAWL_URLS`）发现新链接 -> 自动在 X 发帖
  - 定时日常发帖（`DAILY_POST_INTERVAL_MINUTES` 可配）
  - HTTP 路由 `POST /ops/tweet` 测试发帖

### 环境变量

请复制 `.env.sample` 为 `.env` 并填入：

```
OPENAI_API_KEY=...

# X/Twitter
TWITTER_API_KEY=...
TWITTER_API_SECRET_KEY=...
TWITTER_ACCESS_TOKEN=...
TWITTER_ACCESS_TOKEN_SECRET=...

# 爬虫/发帖
CRAWL_URLS=https://example.com
CRAWL_INTERVAL_MINUTES=10
X_POST_ON_NEW_LINK=true
X_POST_ENABLED=true
DAILY_POST_INTERVAL_MINUTES=180
X_HASHTAGS=#crypto,#web3,#memes
```

### 本地运行

```bash
bun install
bun run build
elizaos dev
```

启动后，Agent 会按照配置启动爬虫与定时发帖服务。

### 测试发帖

```bash
curl -X POST http://localhost:3000/ops/tweet \
  -H 'Content-Type: application/json' \
  -d '{"text":"Onchain Koi 上线测试 🐟"}'
```

### 账号切换

将 `.env` 中的 X 凭据替换为公司运营账号凭据，无需改代码即可切换。

## Development

```bash
# Start development with hot-reloading (recommended)
elizaos dev

# OR start without hot-reloading
elizaos start
# Note: When using 'start', you need to rebuild after changes:
# bun run build

# Test the project
elizaos test
```

## Testing

ElizaOS employs a dual testing strategy:

1. **Component Tests** (`src/__tests__/*.test.ts`)

   - Run with Bun's native test runner
   - Fast, isolated tests using mocks
   - Perfect for TDD and component logic

2. **E2E Tests** (`src/__tests__/e2e/*.e2e.ts`)
   - Run with ElizaOS custom test runner
   - Real runtime with actual database (PGLite)
   - Test complete user scenarios

### Test Structure

```
src/
  __tests__/              # All tests live inside src
    *.test.ts            # Component tests (use Bun test runner)
    e2e/                 # E2E tests (use ElizaOS test runner)
      project-starter.e2e.ts  # E2E test suite
      README.md          # E2E testing documentation
  index.ts               # Export tests here: tests: [ProjectStarterTestSuite]
```

### Running Tests

- `elizaos test` - Run all tests (component + e2e)
- `elizaos test component` - Run only component tests
- `elizaos test e2e` - Run only E2E tests

### Writing Tests

Component tests use bun:test:

```typescript
// Unit test example (__tests__/config.test.ts)
describe('Configuration', () => {
  it('should load configuration correctly', () => {
    expect(config.debug).toBeDefined();
  });
});

// Integration test example (__tests__/integration.test.ts)
describe('Integration: Plugin with Character', () => {
  it('should initialize character with plugins', async () => {
    // Test interactions between components
  });
});
```

E2E tests use ElizaOS test interface:

```typescript
// E2E test example (e2e/project.test.ts)
export class ProjectTestSuite implements TestSuite {
  name = 'project_test_suite';
  tests = [
    {
      name: 'project_initialization',
      fn: async (runtime) => {
        // Test project in a real runtime
      },
    },
  ];
}

export default new ProjectTestSuite();
```

The test utilities in `__tests__/utils/` provide helper functions to simplify writing tests.

## Configuration

Customize your project by modifying:

- `src/index.ts` - Main entry point
- `src/character.ts` - Character definition
