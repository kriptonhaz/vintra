/**
 * Tenant picker — shown after login when the user has multiple
 * tenants and no last-used selection (or the last-used tenant is no
 * longer in their list). Tapping a row commits the selection to
 * secure storage and unblocks the tabs.
 *
 * Also reachable from the More tab as a tenant switcher (any time,
 * not just first-login).
 */
import { Stack, useRouter } from 'expo-router'
import { Pressable } from 'react-native'
import {
  Card,
  H1,
  H4,
  Paragraph,
  ScrollView,
  Separator,
  XStack,
  YStack,
} from 'tamagui'
import { useTenant } from '../lib/tenant-context'

export default function TenantPickerScreen() {
  const { state, selectTenant } = useTenant()
  const router = useRouter()

  if (state.status !== 'needs-picker' && state.status !== 'ready') {
    return null
  }

  const tenants = state.tenants
  const activeId = state.status === 'ready' ? state.tenant.id : null

  async function handlePick(tenantId: string) {
    await selectTenant(tenantId)
    router.replace('/')
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Pilih Usaha' }} />
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <YStack gap="$5">
          <YStack gap="$2">
            <H1>Pilih usaha</H1>
            <Paragraph col="$color10">
              Akun kamu terhubung ke {tenants.length} usaha. Pilih yang
              ingin kamu kelola sekarang — bisa ganti kapan saja dari
              tab Lainnya.
            </Paragraph>
          </YStack>

          <YStack gap="$2">
            {tenants.map((t) => {
              const isActive = t.id === activeId
              return (
                <Pressable key={t.id} onPress={() => handlePick(t.id)}>
                  <Card
                    bordered
                    padding="$4"
                    borderColor={isActive ? '$green8' : '$borderColor'}
                    backgroundColor={isActive ? '$green2' : '$background'}
                  >
                    <XStack jc="space-between" ai="center">
                      <YStack gap="$1" flex={1}>
                        <H4>{t.businessName}</H4>
                        <Paragraph fontSize="$2" col="$color10">
                          Peran: {t.role}
                          {t.slug ? ` · ${t.slug}.vintra.my.id` : ''}
                        </Paragraph>
                      </YStack>
                      {isActive && (
                        <Paragraph
                          fontSize="$1"
                          col="$green11"
                          fontWeight="600"
                        >
                          AKTIF
                        </Paragraph>
                      )}
                    </XStack>
                  </Card>
                </Pressable>
              )
            })}
          </YStack>

          <Separator />
          <Paragraph fontSize="$2" col="$color9" ta="center">
            Daftar usaha baru di vintra.my.id — owner-mu nanti bisa
            tambahkan kamu sebagai member.
          </Paragraph>
        </YStack>
      </ScrollView>
    </>
  )
}
