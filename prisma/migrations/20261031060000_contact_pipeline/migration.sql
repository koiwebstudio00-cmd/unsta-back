ALTER TABLE "Contact" ADD COLUMN "pipelineStage" TEXT NOT NULL DEFAULT 'nuevo';
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_pipelineStage_check" CHECK ("pipelineStage" IN ('nuevo', 'informado', 'seguimiento', 'preinscripcion_declarada', 'inscripcion_simulada', 'sin_interes'));
