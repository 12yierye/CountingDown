<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { AppConfig, CountdownItem } from '@shared/types'
import {
  computeCountdown,
  createCountdownItem,
  findActiveItem,
  formatDateLabel,
  resolveTarget
} from '@shared/defaults'
import CountdownEditor from '@/list/CountdownEditor.vue'
import { emitSaved } from '@/utils/misc'

const props = defineProps<{ config: AppConfig }>()
const emit = defineEmits<{ (event: 'patch', patch: unknown): void }>()

const { t, locale } = useI18n()

const editingId = ref<string | null>(null)

const items = computed(() => props.config.countdowns ?? [])
const enabledItems = computed(() => items.value.filter((item) => item.enabled))
/** 未启用的项单独归一类：它们不能被选为桌面显示 */
const disabledItems = computed(() => items.value.filter((item) => !item.enabled))
const editing = computed(() => items.value.find((item) => item.id === editingId.value) ?? null)
const activeItem = computed(() => findActiveItem(props.config))

interface Row {
  item: CountdownItem
  dateLabel: string
  statusLabel: string
  state: 'future' | 'today' | 'past'
  overridesAppearance: boolean
}

function toRow(item: CountdownItem): Row {
  const target = resolveTarget(item.target, props.config.target)
  const result = computeCountdown(target)
  const absDays = Math.abs(result.days)
  const status =
    result.state === 'future'
      ? t('list.future', { days: result.days })
      : result.state === 'today'
        ? t('list.today')
        : t('list.passed', { days: absDays })
  return {
    item,
    dateLabel: formatDateLabel(target, result.effective, locale.value as unknown as string),
    statusLabel: status,
    state: result.state,
    overridesAppearance: Object.keys(item.appearance ?? {}).length > 0
  }
}

const enabledRows = computed(() => enabledItems.value.map(toRow))
const disabledRows = computed(() => disabledItems.value.map(toRow))

function updateList(next: CountdownItem[]): void {
  emit('patch', { countdowns: next })
  emitSaved()
}

function setActive(item: CountdownItem): void {
  if (!item.enabled) {
    ElMessage.warning(t('list.enableFirst'))
    return
  }
  emit('patch', { activeId: item.id })
  emitSaved()
  ElMessage.success(t('list.setActive'))
}

/** 停用当前桌面显示项时，自动把显示项切到另一个启用的项 */
function toggleEnabled(item: CountdownItem, enabled: boolean): void {
  const next = items.value.map((entry) => (entry.id === item.id ? { ...entry, enabled } : entry))
  const patch: Record<string, unknown> = { countdowns: next }
  if (!enabled && props.config.activeId === item.id) {
    patch.activeId = next.find((entry) => entry.enabled)?.id ?? ''
  }
  emit('patch', patch)
  emitSaved()
}

function openNew(): void {
  const item = createCountdownItem({ name: '' })
  updateList([...items.value, item])
  editingId.value = item.id
}

function openEdit(item: CountdownItem): void {
  editingId.value = item.id
}

function duplicate(item: CountdownItem): void {
  const copy = createCountdownItem({
    ...item,
    id: undefined,
    name: `${item.name}${t('list.duplicateSuffix')}`
  })
  updateList([...items.value, copy])
}

async function remove(item: CountdownItem): Promise<void> {
  try {
    await ElMessageBox.confirm(t('list.deleteConfirm', { name: item.name }), t('list.deleteTitle'), {
      confirmButtonText: t('common.confirm'),
      cancelButtonText: t('common.cancel'),
      type: 'warning'
    })
  } catch {
    return
  }
  const next = items.value.filter((entry) => entry.id !== item.id)
  const patch: Record<string, unknown> = { countdowns: next }
  if (props.config.activeId === item.id) {
    patch.activeId = next.find((entry) => entry.enabled)?.id ?? ''
  }
  emit('patch', patch)
  emitSaved()
  if (editingId.value === item.id) editingId.value = null
}

function saveItem(next: CountdownItem): void {
  updateList(items.value.map((entry) => (entry.id === next.id ? next : entry)))
}

function closeEditor(): void {
  editingId.value = null
}

/** 一键创建示例项，避免列表为空时无从下手 */
function seedSample(): void {
  const now = new Date()
  const item = createCountdownItem({
    name: t('app.name'),
    target: {
      mode: 'annual',
      date: `${now.getFullYear() + 1}-01-01T00:00`,
      month: now.getMonth() + 1,
      day: now.getDate()
    }
  })
  updateList([...items.value, item])
  emit('patch', { activeId: item.id })
  emitSaved()
}
</script>

<template>
  <CountdownEditor
    v-if="editing"
    :key="editing.id"
    :config="config"
    :item="editing"
    @save="saveItem"
    @close="closeEditor"
  />

  <template v-else>
    <el-card shadow="never" class="panel-card">
      <template #header>
        <div class="panel-card__header">
          <div class="list-head">
            <span class="panel-card__title">
              {{ t('list.title') }}
              <el-tooltip :content="t('list.subtitle')" placement="top" :show-after="150">
                <span class="panel-card__help" tabindex="0">
                  <el-icon :size="13"><QuestionFilled /></el-icon>
                </span>
              </el-tooltip>
            </span>
            <span class="list-head__meta">
              {{ t('list.itemCount', { count: items.length }) }} ·
              {{ t('list.enabledCount', { count: enabledItems.length }) }}
            </span>
          </div>
          <el-button type="primary" size="small" @click="openNew">
            <el-icon><Plus /></el-icon>
            <span style="margin-left: 6px">{{ t('list.newItem') }}</span>
          </el-button>
        </div>
      </template>

      <el-alert
        v-if="!items.length"
        class="list-empty"
        type="info"
        :closable="false"
        show-icon
        :title="t('list.empty')"
      >
        <template #default>
          <el-button size="small" plain @click="seedSample">{{ t('list.newItem') }}</el-button>
        </template>
      </el-alert>

      <template v-else>
        <div class="cd-rows">
          <div
            v-for="row in enabledRows"
            :key="row.item.id"
            class="cd-row"
            :class="{ 'is-active': row.item.id === config.activeId }"
          >
            <el-radio
              class="cd-row__pick"
              :model-value="activeItem?.id"
              :value="row.item.id"
              @change="setActive(row.item)"
            >
              <span class="cd-row__radio-label">{{ t('list.showOnDesktop') }}</span>
            </el-radio>

            <div class="cd-row__main" @click="openEdit(row.item)">
              <div class="cd-row__line">
                <span class="cd-row__name">{{ row.item.name || t('editor.unnamed') }}</span>
                <el-tag
                  size="small"
                  effect="plain"
                  :type="
                    row.state === 'today' ? 'success' : row.state === 'past' ? 'warning' : 'primary'
                  "
                >
                  {{ row.statusLabel }}
                </el-tag>
                <el-tag v-if="row.overridesAppearance" size="small" effect="plain" type="danger">
                  {{ t('editor.appearanceActive') }}
                </el-tag>
              </div>
              <div class="cd-row__sub">{{ row.dateLabel }}</div>
            </div>

            <div class="cd-row__actions">
              <el-button size="small" plain @click="toggleEnabled(row.item, false)">
                {{ t('common.disable') }}
              </el-button>
              <el-button size="small" text @click="openEdit(row.item)">
                <el-icon><Edit /></el-icon>
              </el-button>
              <el-button size="small" text @click="duplicate(row.item)">
                <el-icon><CopyDocument /></el-icon>
              </el-button>
              <el-button size="small" text type="danger" @click="remove(row.item)">
                <el-icon><Delete /></el-icon>
              </el-button>
            </div>
          </div>
        </div>

        <template v-if="disabledRows.length">
          <el-divider content-position="left">
            {{ t('list.disabledGroup') }}（{{ disabledRows.length }}）
          </el-divider>
          <div class="cd-rows is-disabled-group">
            <div v-for="row in disabledRows" :key="row.item.id" class="cd-row is-disabled">
              <span class="cd-row__disabled-mark">
                <el-icon><Remove /></el-icon>
              </span>

              <div class="cd-row__main" @click="openEdit(row.item)">
                <div class="cd-row__line">
                  <span class="cd-row__name">{{ row.item.name || t('editor.unnamed') }}</span>
                  <el-tag size="small" effect="plain" type="info">{{ t('common.disabled') }}</el-tag>
                  <el-tag v-if="row.overridesAppearance" size="small" effect="plain" type="danger">
                    {{ t('editor.appearanceActive') }}
                  </el-tag>
                </div>
                <div class="cd-row__sub">{{ row.dateLabel }}</div>
              </div>

              <div class="cd-row__actions">
                <el-button size="small" plain @click="toggleEnabled(row.item, true)">
                  {{ t('common.enabled') }}
                </el-button>
                <el-button size="small" text @click="openEdit(row.item)">
                  <el-icon><Edit /></el-icon>
                </el-button>
                <el-button size="small" text @click="duplicate(row.item)">
                  <el-icon><CopyDocument /></el-icon>
                </el-button>
                <el-button size="small" text type="danger" @click="remove(row.item)">
                  <el-icon><Delete /></el-icon>
                </el-button>
              </div>
            </div>
          </div>
        </template>

        <el-alert
          v-if="!enabledItems.length"
          class="list-empty"
          type="warning"
          :closable="false"
          show-icon
          :title="t('list.emptyOnDesktop')"
        />
      </template>
    </el-card>
  </template>
</template>

<style scoped>
.list-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.list-head__meta {
  font-size: 12px;
  font-weight: 400;
  color: var(--el-text-color-secondary);
}

.list-hint {
  margin: 0 0 12px;
  font-size: 12.5px;  color: var(--el-text-color-secondary);
}

.list-empty {
  margin-bottom: 10px;
}

.cd-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cd-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  background: var(--el-fill-color-blank);
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}

.cd-row:hover {
  border-color: var(--el-color-primary-light-5);
  background: var(--el-fill-color-light);
}

.cd-row.is-active {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.cd-row.is-disabled {
  background: var(--el-fill-color-lighter);
}

.cd-row.is-disabled .cd-row__name {
  opacity: 0.6;
}

.cd-row__pick {
  flex: none;
  margin-right: 0;
}

.cd-row__disabled-mark {
  flex: none;
  width: 20px;
  display: inline-flex;
  justify-content: center;
  color: var(--el-text-color-disabled);
}

.cd-row__radio-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.cd-row__main {
  flex: 1;
  min-width: 0;
  cursor: pointer;
}

.cd-row__line {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.cd-row__name {
  font-size: 14px;
  font-weight: 600;
}

.cd-row__sub {
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.cd-row__actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
}

@media (max-width: 900px) {
  .cd-row__radio-label {
    display: none;
  }
}
</style>
