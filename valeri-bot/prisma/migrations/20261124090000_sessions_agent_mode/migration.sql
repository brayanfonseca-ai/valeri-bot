-- Modo agente de IA ("Hablar con agente"): aditiva, no toca datos existentes.
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "agent_mode" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "agent_session_id" TEXT;
