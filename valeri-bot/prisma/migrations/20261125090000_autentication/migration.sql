-- CreateTable
CREATE TABLE "autentication" (
    "id" TEXT NOT NULL,
    "document" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "autentication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "autentication_document_idx" ON "autentication"("document");

-- CreateIndex
CREATE INDEX "autentication_phone_idx" ON "autentication"("phone");

-- CreateIndex
CREATE INDEX "autentication_created_at_idx" ON "autentication"("created_at");

COMMENT ON TABLE "autentication" IS 'Traza de autenticación por código (prevista, aún no se usa). status: 1 = aprobado, 0 = no pasó.';
