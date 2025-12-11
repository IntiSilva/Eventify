import { clerkClient, currentUser } from '@clerk/nextjs/server'


// Get user data from Clerk
export async function getUserFromClerk() {
  const user = await currentUser();
  return user; // email, name, etc
}

//Clerk client intialization
export const clerk = await clerkClient();