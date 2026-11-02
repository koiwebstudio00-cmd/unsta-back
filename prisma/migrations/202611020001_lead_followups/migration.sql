CREATE TABLE "LeadFollowup" (
 "id" UUID NOT NULL PRIMARY KEY,
 "workspaceId" UUID NOT NULL,
 "contactId" UUID NOT NULL UNIQUE,
 "conversationId" UUID NOT NULL,
 "messageId" UUID NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'awaiting_response',
 "sentCount" INTEGER NOT NULL DEFAULT 0 CHECK ("sentCount" BETWEEN 0 AND 2),
 "dueAt" TIMESTAMP(3),
 "reason" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "LeadFollowup_status_check" CHECK (status IN ('awaiting_response','scheduled','cancelled','exhausted','opted_out')),
 CONSTRAINT "LeadFollowup_contact_scope_fk" FOREIGN KEY ("workspaceId","contactId") REFERENCES "Contact"("workspaceId",id),
 CONSTRAINT "LeadFollowup_conversation_scope_fk" FOREIGN KEY ("workspaceId","conversationId") REFERENCES "Conversation"("workspaceId",id),
 CONSTRAINT "LeadFollowup_message_scope_fk" FOREIGN KEY ("workspaceId","messageId") REFERENCES "Message"("workspaceId",id)
);
CREATE INDEX "LeadFollowup_workspaceId_status_dueAt_idx" ON "LeadFollowup"("workspaceId",status,"dueAt");
ALTER TABLE "LeadFollowup" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeadFollowup" FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON "LeadFollowup" USING ("workspaceId"::text = current_setting('app.workspace_id',true)) WITH CHECK ("workspaceId"::text = current_setting('app.workspace_id',true));
