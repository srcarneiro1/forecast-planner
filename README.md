# Forecast Planner

MVP web para simulação de forecast operacional.

## Stack
- React + TypeScript + Vite
- Supabase (Postgres/Auth/RLS)
- SheetJS para leitura local do Excel
- Cloudflare Pages como destino de deploy

## Desenvolvimento
1. Copie `.env.example` para `.env`.
2. Preencha `VITE_SUPABASE_PUBLISHABLE_KEY` com a chave publishable do projeto.
3. Execute `npm install` e `npm run dev`.

## Cloudflare Pages
- Framework: Vite
- Build command: `npm run build`
- Output directory: `dist`
- Variáveis: `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`

## Regra atual do motor
- Escalas: 5x2 SEG-SEX, 4x3 DOM-QUA e 4x3 QUA-SÁB.
- Fim de semana/feriado é diferente de dia útil fora da escala.
- HE em dia útil é parametrizada e separada da jornada extraordinária de sábado/domingo-feriado.
- Capacidade base é informada por checkout/jornada e produtividade horária é derivada.
- Colmeia móvel zera ressuprimento no cálculo de HC.
