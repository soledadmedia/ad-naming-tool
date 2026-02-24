import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { google } from "googleapis";

export async function POST(request: NextRequest) {
  const session = await getServerSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { renames } = await request.json();

    if (!renames || !Array.isArray(renames)) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const tokenRes = await fetch(`${process.env.NEXTAUTH_URL}/api/auth/session`, {
      headers: {
        cookie: request.headers.get("cookie") || "",
      },
    });
    const sessionData = await tokenRes.json();
    const accessToken = sessionData?.accessToken;

    if (!accessToken) {
      return NextResponse.json({ error: "No access token" }, { status: 401 });
    }

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });

    const drive = google.drive({ version: "v3", auth: oauth2Client });

    let renamed = 0;
    const errors: string[] = [];

    for (const { fileId, newName } of renames) {
      try {
        await drive.files.update({
          fileId,
          requestBody: {
            name: newName,
          },
        });
        renamed++;
      } catch (error) {
        console.error(`Error renaming file ${fileId}:`, error);
        errors.push(fileId);
      }
    }

    return NextResponse.json({
      success: true,
      renamed,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("Error renaming files:", error);
    return NextResponse.json(
      { error: "Failed to rename files" },
      { status: 500 }
    );
  }
}
