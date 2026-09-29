# RecallOps AI — Final Submission Build

This package contains the upgraded frontend and an Express backend wired for Hindsight Cloud.

## 1. Install
Open a terminal in `backend`:

```bash
npm install
```

## 2. Configure Hindsight
Copy `.env.example` to `.env` and put your Hindsight API key in `HINDSIGHT_API_KEY`. The documented Hindsight JavaScript SDK supports `retain`, `recall`, and `reflect`.

## 3. Start

```bash
npm start
```

Open `http://localhost:3000` in Chrome. The Express server serves the existing HTML/CSS/JS frontend.

## 4. Demo flow
1. Open **New Incident**.
2. Click **Load a sample incident**.
3. Click **Analyze with RecallOps**.
4. The backend recalls organizational memory and asks Hindsight Reflect to reason over it.
5. Review the root cause, similar incidents, steps, and AI reasoning.
6. Click **Mark Incident as Resolved**, enter the actual fix, and store it.
7. The resolution is saved locally and retained in Hindsight for future recall.

If the Hindsight key is not configured, the app still runs with local incident memory so the UI can be demonstrated.


## Learning Intelligence

The dashboard now includes a dedicated **Learning Progress** view with:
- learning progress score
- knowledge captured
- memory-assisted analyses
- recurring-pattern count
- learning streak
- 7-day Knowledge Pulse
- team milestones
- next goal
- end-to-end Incident → Recall → Analyze → Resolve → Learn visualization

These browser metrics are tracked in local storage and complement the real Hindsight memory layer.

## Safer startup

Keep the real `backend/.env` file private and do not commit it to GitHub. The ZIP intentionally includes only `.env.example`.
