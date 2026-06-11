/**
 * Customer picker bottom sheet for the mobile Kasir checkout.
 *
 * Two modes inside the same sheet:
 *   - search → type a phone, see hits from `searchCustomersByPhone`,
 *              tap to attach.
 *   - create → "Pelanggan baru" form (name + phone), upserts and attaches.
 *
 * Server is the source of truth for dedup (partial unique index on
 * (tenant, normalized phone)), so creating with an existing phone
 * returns the existing row — we treat the response identically.
 */
import { useState } from 'react'
import { Pressable, TextInput } from 'react-native'
import {
  Button,
  Card,
  Paragraph,
  ScrollView,
  Sheet,
  Spinner,
  XStack,
  YStack,
} from 'tamagui'
import { Phone, Plus, Search, User, UserPlus, X } from '~/lib/icons'
import {
  useCustomerSearch,
  useUpsertCustomer,
  type CustomerSearchHit,
} from '../../lib/customers'
import type { CartCustomer } from '../../lib/cart-context'
import { COLORS } from '../../lib/theme'

type Mode = 'search' | 'create'

export function CustomerPickerSheet({
  open,
  onClose,
  onPick,
}: {
  open: boolean
  onClose: () => void
  onPick: (c: CartCustomer) => void
}) {
  const [mode, setMode] = useState<Mode>('search')
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')

  // Reset state on close so the next open lands on a clean sheet.
  function handleClose() {
    setMode('search')
    setPhone('')
    setName('')
    onClose()
  }

  const search = useCustomerSearch(phone)
  const upsert = useUpsertCustomer()

  function attach(c: CustomerSearchHit) {
    onPick({ id: c.id, name: c.name, phone: c.phone })
    handleClose()
  }

  async function createNew() {
    if (!name.trim()) return
    try {
      const created = await upsert.mutateAsync({
        name: name.trim(),
        phone: phone.trim() || null,
      })
      onPick({ id: created.id, name: created.name, phone: created.phone })
      handleClose()
    } catch {
      // surfaced via upsert.error below
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleClose} snapPoints={[78]} modal>
      <Sheet.Overlay />
      <Sheet.Frame padding="$4" gap="$3" bg={COLORS.background}>
        <Sheet.Handle />
        <Header
          title={mode === 'search' ? 'Pilih Pelanggan' : 'Pelanggan Baru'}
          onClose={handleClose}
        />

        {mode === 'search' ? (
          <>
            <XStack
              ai="center"
              gap="$2"
              bg="$gray3"
              px="$3"
              py="$2.5"
              br="$4"
            >
              <Search size={18} color="$color9" />
              <TextInput
                value={phone}
                onChangeText={setPhone}
                placeholder="Ketik nomor HP (min. 2 digit)…"
                keyboardType="phone-pad"
                style={{ flex: 1, fontSize: 16 }}
                autoFocus
              />
              {phone.length > 0 && (
                <Pressable onPress={() => setPhone('')}>
                  <X size={16} color="$color9" />
                </Pressable>
              )}
            </XStack>

            <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
              <YStack gap="$2">
                {search.isLoading && phone.length >= 2 && (
                  <XStack p="$3" ai="center" jc="center">
                    <Spinner color={COLORS.primary} />
                  </XStack>
                )}
                {search.data?.map((c) => (
                  <Pressable key={c.id} onPress={() => attach(c)}>
                    <Card bordered padded>
                      <XStack ai="center" gap="$3">
                        <YStack
                          w={36}
                          h={36}
                          ai="center"
                          jc="center"
                          br="$10"
                          bg="$green3"
                        >
                          <User size={18} color="$green10" />
                        </YStack>
                        <YStack flex={1}>
                          <Paragraph fontWeight="600" numberOfLines={1}>
                            {c.name}
                          </Paragraph>
                          {c.phone && (
                            <XStack ai="center" gap="$1.5">
                              <Phone size={12} color="$color9" />
                              <Paragraph fontSize="$2" col="$color10">
                                {formatPhoneDisplay(c.phone)}
                              </Paragraph>
                            </XStack>
                          )}
                        </YStack>
                        <Paragraph fontSize="$1" col="$color9">
                          {c.visitCount}× kunjungan
                        </Paragraph>
                      </XStack>
                    </Card>
                  </Pressable>
                ))}
                {search.error && (
                  <Card bordered padded bg="$red2" borderColor="$red8">
                    <Paragraph fontSize="$2" col="$red11">
                      Gagal cari pelanggan:{' '}
                      {(search.error as Error).message ||
                        'cek koneksi atau coba lagi.'}
                    </Paragraph>
                  </Card>
                )}
                {!search.error &&
                  search.data?.length === 0 &&
                  phone.length >= 2 && (
                    <YStack ai="center" gap="$2" p="$4">
                      <Paragraph col="$color10" ta="center">
                        Tidak ada pelanggan dengan nomor itu.
                      </Paragraph>
                    </YStack>
                  )}
              </YStack>
            </ScrollView>

            <Button
              size="$4"
              icon={<UserPlus size={18} color="white" />}
              bg={COLORS.primary}
              color="white"
              borderWidth={0}
              onPress={() => setMode('create')}
            >
              Pelanggan Baru
            </Button>
          </>
        ) : (
          <>
            <YStack gap="$3" flex={1}>
              <YStack gap="$1.5">
                <Paragraph fontSize="$2" col="$color10" fontWeight="600">
                  NAMA *
                </Paragraph>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Nama pelanggan"
                  style={{
                    fontSize: 16,
                    padding: 14,
                    borderWidth: 1,
                    borderColor: '#d4d4d8',
                    borderRadius: 10,
                    backgroundColor: 'white',
                  }}
                  autoFocus
                />
              </YStack>

              <YStack gap="$1.5">
                <Paragraph fontSize="$2" col="$color10" fontWeight="600">
                  NOMOR HP (opsional)
                </Paragraph>
                <TextInput
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="cth. 081234567890"
                  keyboardType="phone-pad"
                  style={{
                    fontSize: 16,
                    padding: 14,
                    borderWidth: 1,
                    borderColor: '#d4d4d8',
                    borderRadius: 10,
                    backgroundColor: 'white',
                  }}
                />
                <Paragraph fontSize="$1" col="$color9">
                  Diisi untuk lookup berikutnya & WA receipt.
                </Paragraph>
              </YStack>

              {upsert.error && (
                <Card bordered padded bg="$red2" borderColor="$red8">
                  <Paragraph fontSize="$2" col="$red11">
                    {(upsert.error as Error).message}
                  </Paragraph>
                </Card>
              )}
            </YStack>

            <XStack gap="$2">
              <Button
                size="$4"
                flex={1}
                onPress={() => setMode('search')}
                disabled={upsert.isPending}
              >
                Kembali
              </Button>
              <Button
                size="$4"
                flex={1}
                bg={COLORS.primary}
                color="white"
                borderWidth={0}
                onPress={createNew}
                disabled={!name.trim() || upsert.isPending}
              >
                {upsert.isPending ? <Spinner color="white" /> : 'Simpan & Pilih'}
              </Button>
            </XStack>
          </>
        )}
      </Sheet.Frame>
    </Sheet>
  )
}

function Header({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <XStack ai="center" jc="space-between">
      <Paragraph fontSize="$6" fontWeight="700">
        {title}
      </Paragraph>
      <Pressable
        onPress={onClose}
        hitSlop={12}
        style={{ padding: 4, borderRadius: 999 }}
      >
        <X size={22} color="$color10" />
      </Pressable>
    </XStack>
  )
}

/** Mirror of the web formatPhoneDisplay so customer hits look familiar. */
function formatPhoneDisplay(phone: string): string {
  if (!phone.startsWith('62')) return phone
  const rest = phone.slice(2)
  const grouped = rest.replace(/(\d{3})(\d{4})(\d+)?/, (_, a, b, c) =>
    c ? `${a} ${b} ${c}` : `${a} ${b}`,
  )
  return `+62 ${grouped}`
}
