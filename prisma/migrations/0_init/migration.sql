-- CreateEnum
CREATE TYPE "ReminderType" AS ENUM ('FORTY_EIGHT_HOURS', 'SAME_DAY', 'MINUTES_BEFORE');

-- CreateEnum
CREATE TYPE "ContactPhoneApps" AS ENUM ('whatsapp', 'telegram', 'both');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'organizer', 'user');

-- CreateEnum
CREATE TYPE "EventCategory" AS ENUM ('music', 'sports', 'education', 'tech', 'health', 'art', 'nightlife', 'gastronomy', 'films', 'theater', 'fitness', 'business', 'finance', 'fashion', 'travel', 'gaming', 'workshop');

-- CreateEnum
CREATE TYPE "RSVPStatus" AS ENUM ('pending', 'confirmed', 'canceled');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" VARCHAR(25) NOT NULL,
    "normalizedUsername" VARCHAR(25) NOT NULL,
    "clerkId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'user',
    "firstName" VARCHAR(50),
    "lastName" VARCHAR(50),
    "imageUrl" TEXT,
    "hasImage" BOOLEAN,
    "phoneNumber" VARCHAR(30),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "title" VARCHAR(60) NOT NULL,
    "normalizedTitle" TEXT,
    "description" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "eventTimeZone" VARCHAR(50) NOT NULL,
    "eventLocalDateKey" INTEGER NOT NULL,
    "eventLocalMinuteOfDay" INTEGER NOT NULL,
    "location" VARCHAR(255) NOT NULL,
    "normalizedLocation" TEXT,
    "category" "EventCategory" NOT NULL,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "featuredByAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "contactPhoneApps" "ContactPhoneApps",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RSVP" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "status" "RSVPStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reminderPreferenceType" "ReminderType",
    "reminderOffsetMinutes" INTEGER,
    "reminderScheduledAt" TIMESTAMP(3),
    "reminderSentAt" TIMESTAMP(3),

    CONSTRAINT "RSVP_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_normalizedUsername_key" ON "User"("normalizedUsername");

-- CreateIndex
CREATE UNIQUE INDEX "User_clerkId_key" ON "User"("clerkId");

-- CreateIndex
CREATE UNIQUE INDEX "User_phoneNumber_key" ON "User"("phoneNumber");

-- CreateIndex
CREATE INDEX "Event_normalizedTitle_idx" ON "Event"("normalizedTitle");

-- CreateIndex
CREATE INDEX "Event_normalizedLocation_idx" ON "Event"("normalizedLocation");

-- CreateIndex
CREATE INDEX "Event_date_idx" ON "Event"("date");

-- CreateIndex
CREATE INDEX "Event_eventLocalDateKey_idx" ON "Event"("eventLocalDateKey");

-- CreateIndex
CREATE UNIQUE INDEX "RSVP_userId_eventId_key" ON "RSVP"("userId", "eventId");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("clerkId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RSVP" ADD CONSTRAINT "RSVP_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("clerkId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RSVP" ADD CONSTRAINT "RSVP_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

