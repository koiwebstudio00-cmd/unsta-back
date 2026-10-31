CREATE TABLE "Account" (
 "id" UUID NOT NULL,
 "email" TEXT NOT NULL,
 "passwordHash" TEXT NOT NULL,
 "workspaceId" UUID NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Account_email_key" ON "Account"("email");
