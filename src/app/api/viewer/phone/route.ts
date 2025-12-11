import { NextResponse } from "next/server";
import { getCurrentUserPhoneNumber } from "@/lib/viewer";

export async function GET() {
  try {
    // Null if theres no session or no phone
    const phone = await getCurrentUserPhoneNumber();
    
    return NextResponse.json(phone, {
      status: 200,
      headers: { 'Cache-Control': 'no-store, must-revalidate' },
    });
  } catch (err) {
    console.error('[GET /api/viewer/phone] failed:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}