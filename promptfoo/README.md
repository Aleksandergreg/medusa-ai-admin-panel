# Promptfoo – Medusa Assistant Evaluation

This setup lets you evaluate prompts and the answers returned by your external AI assistant exposed via the backend route `POST /admin/assistant`.

Prereqs
- Backend running on `http://localhost:9000` with an Admin API key
- Node 20+

Quick start
1) Start dependencies and backend
   - `docker compose up -d` (Postgres)
   - `cd my-medusa-store && npm ci && npm run dev`
2) Export your Admin API key so Promptfoo can authenticate
   - macOS/Linux: `export MEDUSA_ADMIN_API_KEY=sk_...`
   - Windows (PowerShell): `$env:MEDUSA_ADMIN_API_KEY = "sk_..."`
3) Run the evaluation
   - `npx promptfoo@latest eval -c promptfoo/promptfooconfig.yaml -d promptfoo/datasets/prompts.yaml`

What it does
- Calls `http://localhost:9000/admin/assistant` with the `prompt` from the dataset.
- Extracts the `answer` field from the JSON response (`responsePath: answer`).
- Applies a minimal assertion (`not-empty`) to ensure a response is returned.

Customize
- Change or expand prompts in `promptfoo/datasets/prompts.yaml`.
- Toggle charts by setting `wantsChart: true` on any test case or change defaults under `vars`.
- If your backend runs elsewhere, update `url` in `promptfoo/promptfooconfig.yaml`.
- To inspect the full JSON (`answer`, `data`, `history`), remove `responsePath: answer` in `promptfooconfig.yaml` and re-run.

Tips
- Ensure CORS and auth are set correctly as in the repo’s root `README.md` and `AGENTS.md`.
- You can iterate quickly by editing the dataset and re-running the same `npx promptfoo` command.

Scripts
- npx promptfoo@latest view .promptfoo/last-run
- npx promptfoo@latest eval -c promptfoo/promptfooconfig.yaml promptfoo/datasets/prompts.yaml