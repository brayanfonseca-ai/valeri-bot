-- Fragmento `contacts` del webhook de Meta por cada mensaje entrante (una sola columna).
CREATE TABLE IF NOT EXISTS "json" (
    "contacts" JSONB NOT NULL
);
