# Stargayte

스타크래프트: 리마스터 동호회 클럽 대항전 전적 관리 웹 앱.

> React 19 · TypeScript(strict) · Vite · Zustand · @floating-ui/dom · lucide-react

## 로컬 실행

```bash
npm install
cp .env.example .env.local   # VITE_API_BASE (기본 http://localhost:8000)
npm run dev                  # http://localhost:5173
```

[stargayte-api](../stargayte-api) 서버가 함께 떠 있어야 로그인·데이터 조회가 동작합니다.

```bash
npm run build     # 타입 검사(tsc -b) + 프로덕션 빌드
npm run preview   # 빌드 결과 미리보기
npm run lint      # ESLint
```
