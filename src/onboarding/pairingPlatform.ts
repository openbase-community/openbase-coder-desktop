export function usesManagedLinuxTailscale(platform: string | undefined): boolean {
  return platform === "linux";
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
