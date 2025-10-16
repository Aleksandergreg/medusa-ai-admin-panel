import { format } from "date-fns-tz";
import { formatISO } from "date-fns";

/**
 * Gets current date and time information for both user display (local timezone)
 * and Medusa operations (UTC)
 */
export function getCurrentDateTimeInfo(): {
  userLocalDate: string;
  userLocalTime: string;
  userLocalDateTime: string;
  userTimezone: string;
  utcDate: string;
  utcDateTime: string;
} {
  const now = new Date();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return {
    // User-facing date/time in their local timezone
    // Using format with timeZone option directly formats the date in that timezone
    userLocalDate: format(now, "yyyy-MM-dd", { timeZone: timezone }),
    userLocalTime: format(now, "HH:mm:ss", { timeZone: timezone }),
    userLocalDateTime: format(now, "yyyy-MM-dd HH:mm:ss", {
      timeZone: timezone,
    }),
    userTimezone: timezone,

    // UTC for Medusa operations
    utcDate: now.toISOString().split("T")[0],
    utcDateTime: formatISO(now),
  };
}
