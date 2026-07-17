"use node";

import { ConvexError, v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";
import { google, type sheets_v4 } from "googleapis";
import {
  FORMULA_COLUMN_RANGES,
  JUDGING_DATA_START_ROW,
  JUDGING_HEADER_ROW,
  JUDGING_HEADERS,
  JUDGING_SHEET_NAME,
  MAXIMUM_SCORE,
  ROUND_ONE_SCORE_COLUMN_INDICES,
  ROUND_TWO_SCORE_COLUMN_INDICES,
  buildJudgingSheetValues,
  type JudgingSheetSubmission,
} from "../lib/judging-sheet";

const GOOGLE_SHEETS_MIME_TYPE = "application/vnd.google-apps.spreadsheet";
const GOOGLE_DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new ConvexError(`${name} is not configured for this Convex deployment.`);
  return value;
}

function googleAuth() {
  const email = requiredEnvironment("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const key = requiredEnvironment("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n");
  return new google.auth.JWT({
    email,
    key,
    scopes: [
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/spreadsheets",
    ],
  });
}

function googleApiStatus(error: unknown) {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = error as { code?: unknown; response?: { status?: unknown } };
  if (typeof candidate.code === "number") return candidate.code;
  return typeof candidate.response?.status === "number" ? candidate.response.status : undefined;
}

function scoreValidationRequest(sheetId: number, columnIndex: number, endRowIndex: number) {
  return {
    setDataValidation: {
      range: {
        sheetId,
        startRowIndex: JUDGING_DATA_START_ROW - 1,
        endRowIndex,
        startColumnIndex: columnIndex,
        endColumnIndex: columnIndex + 1,
      },
      rule: {
        condition: {
          type: "NUMBER_BETWEEN",
          values: [
            { userEnteredValue: "0" },
            { userEnteredValue: String(MAXIMUM_SCORE) },
          ],
        },
        inputMessage: `Enter a score from 0 to ${MAXIMUM_SCORE}.`,
        strict: true,
        showCustomUi: true,
      },
    },
  } satisfies sheets_v4.Schema$Request;
}

function columnWidthRequest(
  sheetId: number,
  startColumnIndex: number,
  endColumnIndex: number,
  pixelSize: number,
) {
  return {
    updateDimensionProperties: {
      range: {
        sheetId,
        dimension: "COLUMNS",
        startIndex: startColumnIndex,
        endIndex: endColumnIndex,
      },
      properties: { pixelSize },
      fields: "pixelSize",
    },
  } satisfies sheets_v4.Schema$Request;
}

function formattingRequests(sheetId: number, rowCount: number) {
  const endRowIndex = Math.max(rowCount, JUDGING_DATA_START_ROW);
  const requests: sheets_v4.Schema$Request[] = [
    {
      updateSheetProperties: {
        properties: {
          sheetId,
          title: JUDGING_SHEET_NAME,
          gridProperties: {
            frozenRowCount: JUDGING_HEADER_ROW,
            frozenColumnCount: 4,
          },
        },
        fields: "title,gridProperties.frozenRowCount,gridProperties.frozenColumnCount",
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 },
        properties: { hiddenByUser: true },
        fields: "hiddenByUser",
      },
    },
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 2,
          startColumnIndex: 0,
          endColumnIndex: 8,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.95, green: 0.96, blue: 0.98 },
            textFormat: { bold: true },
            verticalAlignment: "MIDDLE",
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,verticalAlignment)",
      },
    },
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: JUDGING_HEADER_ROW - 1,
          endRowIndex: JUDGING_HEADER_ROW,
          startColumnIndex: 0,
          endColumnIndex: JUDGING_HEADERS.length,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.08, green: 0.12, blue: 0.2 },
            horizontalAlignment: "CENTER",
            textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
            verticalAlignment: "MIDDLE",
            wrapStrategy: "WRAP",
          },
        },
        fields:
          "userEnteredFormat(backgroundColor,horizontalAlignment,textFormat,verticalAlignment,wrapStrategy)",
      },
    },
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: JUDGING_DATA_START_ROW - 1,
          endRowIndex,
          startColumnIndex: 0,
          endColumnIndex: JUDGING_HEADERS.length,
        },
        cell: {
          userEnteredFormat: {
            verticalAlignment: "TOP",
            wrapStrategy: "WRAP",
          },
        },
        fields: "userEnteredFormat(verticalAlignment,wrapStrategy)",
      },
    },
    {
      setBasicFilter: {
        filter: {
          range: {
            sheetId,
            startRowIndex: JUDGING_HEADER_ROW - 1,
            endRowIndex,
            startColumnIndex: 0,
            endColumnIndex: JUDGING_HEADERS.length,
          },
        },
      },
    },
    columnWidthRequest(sheetId, 1, 3, 190),
    columnWidthRequest(sheetId, 3, 4, 220),
    columnWidthRequest(sheetId, 4, 5, 320),
    columnWidthRequest(sheetId, 5, 7, 150),
    columnWidthRequest(sheetId, 7, 14, 150),
    columnWidthRequest(sheetId, 14, JUDGING_HEADERS.length, 120),
  ];

  for (const columnIndex of [
    ...ROUND_ONE_SCORE_COLUMN_INDICES,
    ...ROUND_TWO_SCORE_COLUMN_INDICES,
  ]) {
    requests.push(scoreValidationRequest(sheetId, columnIndex, endRowIndex));
    requests.push(columnWidthRequest(sheetId, columnIndex, columnIndex + 1, 78));
  }

  for (const range of FORMULA_COLUMN_RANGES) {
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: JUDGING_DATA_START_ROW - 1,
          endRowIndex,
          ...range,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.92, green: 0.96, blue: 1 },
            textFormat: { bold: true },
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat)",
      },
    });
    requests.push({
      addProtectedRange: {
        protectedRange: {
          range: {
            sheetId,
            startRowIndex: JUDGING_DATA_START_ROW - 1,
            endRowIndex,
            ...range,
          },
          description: "Formula cells",
          warningOnly: true,
        },
      },
    });
  }

  requests.push({
    addConditionalFormatRule: {
      index: 0,
      rule: {
        ranges: [
          {
            sheetId,
            startRowIndex: JUDGING_DATA_START_ROW - 1,
            endRowIndex,
            startColumnIndex: 0,
            endColumnIndex: JUDGING_HEADERS.length,
          },
        ],
        booleanRule: {
          condition: {
            type: "CUSTOM_FORMULA",
            values: [{ userEnteredValue: `=$AD${JUDGING_DATA_START_ROW}=TRUE` }],
          },
          format: { backgroundColor: { red: 0.9, green: 0.98, blue: 0.91 } },
        },
      },
    },
  });

  return requests;
}

export const createJudgingSheet = action({
  args: { slug: v.string(), adminToken: v.string() },
  handler: async (ctx, args): Promise<{ spreadsheetUrl: string; created: boolean }> => {
    const admin = await ctx.runQuery(api.events.getAdmin, args);
    if (admin.event.eventType !== "hackathon") {
      throw new ConvexError("Judging Sheets are only available for hackathon events.");
    }
    if (admin.event.judgingSheetUrl) {
      return { spreadsheetUrl: admin.event.judgingSheetUrl, created: false };
    }

    const folderId = requiredEnvironment("GOOGLE_DRIVE_FOLDER_ID");
    const auth = googleAuth();
    const drive = google.drive({ version: "v3", auth });
    const sheets = google.sheets({ version: "v4", auth });
    const title = `${admin.event.name} judging`;
    let spreadsheetId: string | undefined;

    try {
      let folder;
      try {
        folder = await drive.files.get({
          fileId: folderId,
          supportsAllDrives: true,
          fields: "mimeType,driveId,capabilities(canAddChildren)",
        });
      } catch (error) {
        if (googleApiStatus(error) === 404) {
          throw new ConvexError(
            "The configured Google Drive folder is not accessible to the service account.",
          );
        }
        throw error;
      }
      if (folder.data.mimeType !== GOOGLE_DRIVE_FOLDER_MIME_TYPE) {
        throw new ConvexError("GOOGLE_DRIVE_FOLDER_ID must point to a Google Drive folder.");
      }
      if (!folder.data.driveId) {
        throw new ConvexError(
          "The configured Google Drive folder must be inside a Shared Drive, not My Drive.",
        );
      }
      if (!folder.data.capabilities?.canAddChildren) {
        throw new ConvexError(
          "The service account needs permission to add files to the configured Shared Drive folder.",
        );
      }

      const createdFile = await drive.files.create({
        supportsAllDrives: true,
        requestBody: {
          name: title,
          mimeType: GOOGLE_SHEETS_MIME_TYPE,
          parents: [folderId],
        },
        fields: "id",
      });
      spreadsheetId = createdFile.data.id ?? undefined;
      if (!spreadsheetId) throw new ConvexError("Google did not return a spreadsheet ID.");

      const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: "sheets.properties(sheetId)",
      });
      const sheetId = spreadsheet.data.sheets?.[0]?.properties?.sheetId;
      if (sheetId === undefined || sheetId === null) {
        throw new ConvexError("Google did not create the judging tab.");
      }

      const allSubmissions = [
        ...admin.lineup,
        ...admin.pool,
        ...admin.hidden,
        ...admin.completed,
        ...admin.noShows,
        ...admin.withdrawn,
      ];
      const uniqueSubmissions = [
        ...new Map(allSubmissions.map((submission) => [submission.id, submission])).values(),
      ].sort((a, b) => a.createdAt - b.createdAt) as JudgingSheetSubmission[];
      const values = buildJudgingSheetValues({
        eventName: admin.event.name,
        meetUrl: admin.event.meetUrl,
        submissions: uniqueSubmissions,
      });

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: formattingRequests(sheetId, values.length) },
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${JUDGING_SHEET_NAME}!A1`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values },
      });

      const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
      const saved = await ctx.runMutation(api.events.saveJudgingSheet, {
        ...args,
        spreadsheetId,
        spreadsheetUrl,
      });
      if (!saved.created && saved.spreadsheetId !== spreadsheetId) {
        await drive.files.update({
          fileId: spreadsheetId,
          supportsAllDrives: true,
          requestBody: { trashed: true },
        });
      }
      return { spreadsheetUrl: saved.spreadsheetUrl, created: saved.created };
    } catch (error) {
      if (spreadsheetId) {
        await drive.files
          .update({
            fileId: spreadsheetId,
            supportsAllDrives: true,
            requestBody: { trashed: true },
          })
          .catch(() => undefined);
      }
      if (error instanceof ConvexError) throw error;
      const message = error instanceof Error ? error.message : "Unknown Google API error";
      throw new ConvexError(`Could not create the judging Sheet: ${message}`);
    }
  },
});
