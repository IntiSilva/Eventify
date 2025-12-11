import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import type { UserProfileForAvatar } from "@/types/rsvp";

export async function getCurrentUserPhoneNumber(): Promise<string | null> {
  const { userId: clerkId } = await auth();
  if (!clerkId) return null;
  const user = await prisma.user.findUnique({
    where: { clerkId },
    select: { phoneNumber: true },
  });
  return user?.phoneNumber ?? null;
}

export async function getCurrentUserFromDb(){

    //first auth() reads the clerk session and brings back userId
    const { userId } = await auth();
    
    //then if there's no userId, user isn't authenticated or doesn't exist
    if(!userId) return null;

    //search in User table for the records with clerkId = userId
    const user = await prisma.user.findUnique({
        where: {
            clerkId: userId
        }
    });
    
    return user;
};

export async function getCurrentUserPublic(): Promise<UserProfileForAvatar | null> {
  const { userId } = await auth();
  if (!userId) return null;

  const u = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: {
      clerkId: true,
      username: true,
      firstName: true,
      lastName: true,
      imageUrl: true,
      hasImage: true,
      role: true,
    },
  });

  if (!u) return null;
  // Coherence for imageUrl
  return { ...u, hasImage: u.hasImage ?? Boolean(u.imageUrl) };
}