from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import db
from config import settings
from services.benchmarker import AutoBenchmarker, fetch_university_features, fetch_classifications
from routers import institutions, peers, portfolio, federal, qa, classifications, briefing


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect_pool()

    # Fit the KNN benchmarker once at startup (per CLAUDE.md: "Cache reads,
    # never writes"). Every request reuses this same fitted model instead
    # of re-fitting per request.
    features_df = await fetch_university_features(db.get_pool())
    classifications_df = await fetch_classifications(db.get_pool())
    app.state.benchmarker = AutoBenchmarker(n_peers=settings.n_peers_default).fit(
        features_df, classifications_df
    )

    yield

    await db.close_pool()


app = FastAPI(title="NSF HERD API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(institutions.router)
app.include_router(peers.router)
app.include_router(portfolio.router)
app.include_router(federal.router)
app.include_router(qa.router)
app.include_router(classifications.router)
app.include_router(briefing.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
