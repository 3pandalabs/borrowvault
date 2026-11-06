import * as Linking from "expo-linking";

/** Opens a BorrowVault web page in the browser; returns error copy on failure. */
export async function openWeb(url: string): Promise<string | null> {
  try {
    await Linking.openURL(url);
    return null;
  } catch {
    return "Couldn't open your browser. Visit borrowvault.3pandalabs.com on any device instead.";
  }
}
