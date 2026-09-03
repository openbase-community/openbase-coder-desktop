export function usesManagedLinuxTailscale(_platform: string | undefined): boolean {
  // The legacy flow opened the third-party Tailscale client from Electron.
  // Electron now offers Openbase Direct on Linux through the shared transport
  // flow, so this route must remain disabled while its old state is retired.
  return false;
}

export function usesDurableLinuxOnboardingCompletion(
  platform: string | undefined,
  completed: boolean,
): boolean {
  return usesManagedLinuxTailscale(platform) && completed;
}

export function waitsForLinuxOnboardingFlags(
  platform: string | undefined,
  flagsLoaded: boolean,
): boolean {
  return usesManagedLinuxTailscale(platform) && !flagsLoaded;
}
