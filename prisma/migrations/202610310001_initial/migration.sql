-- CreateTable
CREATE TABLE "Workspace" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invite" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "workspaceId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "csrfHash" TEXT NOT NULL,
    "workspaceId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispatch" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "entityId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "leaseId" TEXT,
    "lastCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Dispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Knowledge" (
    "version" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "document" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Knowledge_pkey" PRIMARY KEY ("version")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "fields" JSONB NOT NULL DEFAULT '{}',
    "protectedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'bot',
    "controlVersion" INTEGER NOT NULL DEFAULT 1,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "summaryThrough" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "clientMessageId" TEXT,
    "turnId" UUID,
    "recordIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Turn" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'encolado',
    "attemptId" UUID,
    "tokenHash" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "summaryUntil" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "controlVersion" INTEGER NOT NULL DEFAULT 1,
    "knowledgeVersion" TEXT NOT NULL,
    "knowledgeHash" TEXT NOT NULL,
    "context" JSONB,
    "recordIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "executionId" TEXT,
    "workflowId" TEXT,
    "handoffId" UUID,
    "completionHash" TEXT,
    "result" JSONB,
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Turn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interest" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "identity" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'nuevo',
    "evidenceId" UUID NOT NULL,
    "protectedFields" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Interest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttentionCase" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "turnId" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "area" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pendiente',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttentionCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolCall" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "turnId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "argumentHash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pendiente',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "proposalId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'activa',
    "evidenceId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpeningEvent" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "proposalId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "simulated" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'encolado',
    "attemptId" UUID,
    "tokenHash" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "executionId" TEXT,
    "workflowId" TEXT,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpeningEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notice" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "simulated" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Audit" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" UUID NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "executionId" TEXT,
    "workflowId" TEXT,
    "node" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invite_tokenHash_key" ON "Invite"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Dispatch_entityId_key" ON "Dispatch"("entityId");

-- CreateIndex
CREATE INDEX "Dispatch_status_availableAt_idx" ON "Dispatch"("status", "availableAt");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_workspaceId_id_key" ON "Contact"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "Conversation_workspaceId_contactId_idx" ON "Conversation"("workspaceId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_workspaceId_id_key" ON "Conversation"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Message_turnId_key" ON "Message"("turnId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_workspaceId_id_key" ON "Message"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Message_conversationId_sequence_key" ON "Message"("conversationId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "Message_conversationId_clientMessageId_key" ON "Message"("conversationId", "clientMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "Turn_messageId_key" ON "Turn"("messageId");

-- CreateIndex
CREATE INDEX "Turn_conversationId_status_createdAt_idx" ON "Turn"("conversationId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Turn_workspaceId_id_key" ON "Turn"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Interest_workspaceId_id_key" ON "Interest"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Interest_contactId_identity_key" ON "Interest"("contactId", "identity");

-- CreateIndex
CREATE UNIQUE INDEX "AttentionCase_workspaceId_id_key" ON "AttentionCase"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ToolCall_turnId_name_argumentHash_key" ON "ToolCall"("turnId", "name", "argumentHash");

-- CreateIndex
CREATE UNIQUE INDEX "Task_workspaceId_id_key" ON "Task"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_contactId_proposalId_key" ON "Subscription"("contactId", "proposalId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_workspaceId_id_key" ON "Subscription"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "OpeningEvent_workspaceId_id_key" ON "OpeningEvent"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Notice_eventId_subscriptionId_key" ON "Notice"("eventId", "subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "Incident_dedupeKey_key" ON "Incident"("dedupeKey");


ALTER TABLE "Contact" ADD CONSTRAINT "Contact_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"(id);
ALTER TABLE "Contact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Contact" FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON "Contact" USING ("workspaceId"::text = current_setting('app.workspace_id',true)) WITH CHECK ("workspaceId"::text = current_setting('app.workspace_id',true));

ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"(id);
ALTER TABLE "Conversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Conversation" FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON "Conversation" USING ("workspaceId"::text = current_setting('app.workspace_id',true)) WITH CHECK ("workspaceId"::text = current_setting('app.workspace_id',true));

ALTER TABLE "Message" ADD CONSTRAINT "Message_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"(id);
ALTER TABLE "Message" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Message" FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON "Message" USING ("workspaceId"::text = current_setting('app.workspace_id',true)) WITH CHECK ("workspaceId"::text = current_setting('app.workspace_id',true));

ALTER TABLE "Turn" ADD CONSTRAINT "Turn_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"(id);
ALTER TABLE "Turn" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Turn" FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON "Turn" USING ("workspaceId"::text = current_setting('app.workspace_id',true)) WITH CHECK ("workspaceId"::text = current_setting('app.workspace_id',true));

ALTER TABLE "Interest" ADD CONSTRAINT "Interest_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"(id);
ALTER TABLE "Interest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Interest" FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON "Interest" USING ("workspaceId"::text = current_setting('app.workspace_id',true)) WITH CHECK ("workspaceId"::text = current_setting('app.workspace_id',true));

ALTER TABLE "AttentionCase" ADD CONSTRAINT "AttentionCase_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"(id);
ALTER TABLE "AttentionCase" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AttentionCase" FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON "AttentionCase" USING ("workspaceId"::text = current_setting('app.workspace_id',true)) WITH CHECK ("workspaceId"::text = current_setting('app.workspace_id',true));

ALTER TABLE "ToolCall" ADD CONSTRAINT "ToolCall_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"(id);
ALTER TABLE "ToolCall" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ToolCall" FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON "ToolCall" USING ("workspaceId"::text = current_setting('app.workspace_id',true)) WITH CHECK ("workspaceId"::text = current_setting('app.workspace_id',true));

ALTER TABLE "Note" ADD CONSTRAINT "Note_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"(id);
ALTER TABLE "Note" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Note" FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON "Note" USING ("workspaceId"::text = current_setting('app.workspace_id',true)) WITH CHECK ("workspaceId"::text = current_setting('app.workspace_id',true));

ALTER TABLE "Task" ADD CONSTRAINT "Task_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"(id);
ALTER TABLE "Task" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Task" FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON "Task" USING ("workspaceId"::text = current_setting('app.workspace_id',true)) WITH CHECK ("workspaceId"::text = current_setting('app.workspace_id',true));

ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"(id);
ALTER TABLE "Subscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Subscription" FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON "Subscription" USING ("workspaceId"::text = current_setting('app.workspace_id',true)) WITH CHECK ("workspaceId"::text = current_setting('app.workspace_id',true));

ALTER TABLE "OpeningEvent" ADD CONSTRAINT "OpeningEvent_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"(id);
ALTER TABLE "OpeningEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OpeningEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON "OpeningEvent" USING ("workspaceId"::text = current_setting('app.workspace_id',true)) WITH CHECK ("workspaceId"::text = current_setting('app.workspace_id',true));

ALTER TABLE "Notice" ADD CONSTRAINT "Notice_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"(id);
ALTER TABLE "Notice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notice" FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON "Notice" USING ("workspaceId"::text = current_setting('app.workspace_id',true)) WITH CHECK ("workspaceId"::text = current_setting('app.workspace_id',true));

ALTER TABLE "Audit" ADD CONSTRAINT "Audit_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"(id);
ALTER TABLE "Audit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Audit" FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON "Audit" USING ("workspaceId"::text = current_setting('app.workspace_id',true)) WITH CHECK ("workspaceId"::text = current_setting('app.workspace_id',true));
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_contactId_scope_fk" FOREIGN KEY ("workspaceId","contactId") REFERENCES "Contact"("workspaceId",id);
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_scope_fk" FOREIGN KEY ("workspaceId","conversationId") REFERENCES "Conversation"("workspaceId",id);
ALTER TABLE "Turn" ADD CONSTRAINT "Turn_conversationId_scope_fk" FOREIGN KEY ("workspaceId","conversationId") REFERENCES "Conversation"("workspaceId",id);
ALTER TABLE "Turn" ADD CONSTRAINT "Turn_messageId_scope_fk" FOREIGN KEY ("workspaceId","messageId") REFERENCES "Message"("workspaceId",id);
ALTER TABLE "Interest" ADD CONSTRAINT "Interest_contactId_scope_fk" FOREIGN KEY ("workspaceId","contactId") REFERENCES "Contact"("workspaceId",id);
ALTER TABLE "Interest" ADD CONSTRAINT "Interest_evidenceId_scope_fk" FOREIGN KEY ("workspaceId","evidenceId") REFERENCES "Message"("workspaceId",id);
ALTER TABLE "AttentionCase" ADD CONSTRAINT "AttentionCase_conversationId_scope_fk" FOREIGN KEY ("workspaceId","conversationId") REFERENCES "Conversation"("workspaceId",id);
ALTER TABLE "AttentionCase" ADD CONSTRAINT "AttentionCase_turnId_scope_fk" FOREIGN KEY ("workspaceId","turnId") REFERENCES "Turn"("workspaceId",id);
ALTER TABLE "ToolCall" ADD CONSTRAINT "ToolCall_turnId_scope_fk" FOREIGN KEY ("workspaceId","turnId") REFERENCES "Turn"("workspaceId",id);
ALTER TABLE "Note" ADD CONSTRAINT "Note_contactId_scope_fk" FOREIGN KEY ("workspaceId","contactId") REFERENCES "Contact"("workspaceId",id);
ALTER TABLE "Task" ADD CONSTRAINT "Task_contactId_scope_fk" FOREIGN KEY ("workspaceId","contactId") REFERENCES "Contact"("workspaceId",id);
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_contactId_scope_fk" FOREIGN KEY ("workspaceId","contactId") REFERENCES "Contact"("workspaceId",id);
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_evidenceId_scope_fk" FOREIGN KEY ("workspaceId","evidenceId") REFERENCES "Message"("workspaceId",id);
ALTER TABLE "Notice" ADD CONSTRAINT "Notice_contactId_scope_fk" FOREIGN KEY ("workspaceId","contactId") REFERENCES "Contact"("workspaceId",id);
ALTER TABLE "Notice" ADD CONSTRAINT "Notice_eventId_scope_fk" FOREIGN KEY ("workspaceId","eventId") REFERENCES "OpeningEvent"("workspaceId",id);
ALTER TABLE "Notice" ADD CONSTRAINT "Notice_subscriptionId_scope_fk" FOREIGN KEY ("workspaceId","subscriptionId") REFERENCES "Subscription"("workspaceId",id);

CREATE UNIQUE INDEX one_open_case ON "AttentionCase"("conversationId") WHERE status IN ('pendiente','tomado');
CREATE UNIQUE INDEX one_running_turn ON "Turn"("conversationId") WHERE status='procesando';
ALTER TABLE "Conversation" ADD CHECK (mode IN ('bot','esperando_humano','humano','cerrada'));
ALTER TABLE "Turn" ADD CHECK (status IN ('encolado','procesando','completado','cancelado','fallido'));
ALTER TABLE "Interest" ADD CHECK (stage IN ('nuevo','informado','seguimiento','preinscripcion_declarada','inscripcion_simulada','sin_interes'));
ALTER TABLE "AttentionCase" ADD CHECK (status IN ('pendiente','tomado','resuelto'));
ALTER TABLE "Message" ADD CHECK (role IN ('user','assistant','operator'));
ALTER TABLE "Subscription" ADD CHECK (status IN ('activa','cancelada'));
ALTER TABLE "OpeningEvent" ADD CHECK (simulated=true);
ALTER TABLE "Notice" ADD CHECK (simulated=true);
REVOKE ALL ON SCHEMA public FROM PUBLIC;
