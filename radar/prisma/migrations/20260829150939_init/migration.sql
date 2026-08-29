-- CreateTable
CREATE TABLE "Show" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "feedUrl" TEXT,
    "hosts" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "lenses" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "maxEpisodesPerRun" INTEGER NOT NULL DEFAULT 2,
    "speakersExpected" INTEGER
);

-- CreateTable
CREATE TABLE "Episode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "showId" TEXT NOT NULL,
    "guid" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "publishedAt" DATETIME NOT NULL,
    "durationSec" INTEGER,
    "audioUrl" TEXT NOT NULL,
    "pageUrl" TEXT,
    "providedTranscriptUrl" TEXT,
    "providedTranscriptType" TEXT,
    "providedTranscriptRefusedReason" TEXT,
    "status" TEXT NOT NULL,
    "source" TEXT,
    "audioPath" TEXT,
    "transcriptId" TEXT,
    "errorMessage" TEXT,
    "estCostUsd" REAL,
    "speakersExpected" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Episode_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Utterance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "episodeId" TEXT NOT NULL,
    "idx" INTEGER NOT NULL,
    "speakerLabel" TEXT NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "confidence" REAL,
    CONSTRAINT "Utterance_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SpeakerMap" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "episodeId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "manual" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "SpeakerMap_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RunLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "command" TEXT NOT NULL,
    "dryRun" BOOLEAN NOT NULL,
    "discovered" INTEGER NOT NULL DEFAULT 0,
    "transcribed" INTEGER NOT NULL DEFAULT 0,
    "imported" INTEGER NOT NULL DEFAULT 0,
    "named" INTEGER NOT NULL DEFAULT 0,
    "exported" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "minutesUsed" REAL NOT NULL DEFAULT 0,
    "estCostUsd" REAL NOT NULL DEFAULT 0,
    "notes" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "Show_slug_key" ON "Show"("slug");

-- CreateIndex
CREATE INDEX "Episode_status_idx" ON "Episode"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Episode_showId_guid_key" ON "Episode"("showId", "guid");

-- CreateIndex
CREATE UNIQUE INDEX "Utterance_episodeId_idx_key" ON "Utterance"("episodeId", "idx");

-- CreateIndex
CREATE UNIQUE INDEX "SpeakerMap_episodeId_label_key" ON "SpeakerMap"("episodeId", "label");
