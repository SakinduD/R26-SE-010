"""
Adaptive Pedagogical Module (APM) services.

The APM is the integration broker between Personality Survey, the Role-Play
Simulation Engine (RPE), and Multimodal Communication Analysis (MCA).

Module layout:
  types              — shared Pydantic types (OceanScores, TeachingStrategy, ...)
  strategy_optimizer — PURE: OCEAN -> TeachingStrategy
  dda_engine         — PURE: OCEAN -> initial difficulty (1-10)
  dynamic_adjuster   — PURE: signal -> adjusted strategy/difficulty
  aggregator         — PURE: external signals -> PerformanceSignal
  adapter            — ONLY scale-conversion site (0-100 <-> 0-1)
  scenario_selector  — async: RPE library + Gemini fallback
  orchestrator       — wires everything together (DB + RPE + LLM)

APM never writes to the analytics tables. The analytics module reports on
multimodal sessions only and hands its learner signal back to APM as a pull
(analytics_feedback_loop_service, read by plan_service).
"""
