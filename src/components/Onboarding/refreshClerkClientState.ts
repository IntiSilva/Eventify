type ReloadableUser = {
  reload: () => Promise<unknown> | unknown
}

type ReloadableSession = {
  reload: () => Promise<unknown> | unknown
} | null | undefined

type RefreshableRouter = {
  refresh: () => void
}

export async function refreshClerkClientStateAfterOnboarding(input: {
  user: ReloadableUser
  session?: ReloadableSession
  router: RefreshableRouter
  refreshRouter?: boolean
}): Promise<void> {
  await input.user.reload()
  await input.session?.reload()
  if (input.refreshRouter !== false) {
    input.router.refresh()
  }
}
