<script lang="ts">
  import { ApiHttpError, loginWithPassword } from '../../lib/api';
  import { registerLocaleGlob, t, type MessageTree } from '../../lib/i18n/index.svelte';
  import { BrandMark, Button, Field, Input } from '../../ui';

  registerLocaleGlob(
    'auth',
    import.meta.glob<{ default: MessageTree }>('./locales/*.json', { eager: true })
  );

  interface Props {
    siteTitle?: string;
    previewError?: string;
    onsuccess?: () => void;
  }

  let { siteTitle = 'pikbay', previewError = '', onsuccess }: Props = $props();

  let username = $state('admin');
  let password = $state('');
  let busy = $state(false);
  let errorMsg = $state('');

  const shownError = $derived(errorMsg || previewError);

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (busy) return;

    const u = username.trim();
    if (!u || !password) {
      errorMsg = t('required', undefined, 'auth');
      return;
    }

    busy = true;
    errorMsg = '';
    try {
      await loginWithPassword(u, password);
      password = '';
      onsuccess?.();
    } catch (err) {
      if (err instanceof ApiHttpError) {
        if (err.status === 429) {
          errorMsg = t('rateLimited', undefined, 'auth');
        } else if (err.status === 401) {
          errorMsg = t('invalid', undefined, 'auth');
        } else {
          errorMsg = err.message;
        }
      } else {
        errorMsg = t('networkError', undefined, 'auth');
      }
    } finally {
      busy = false;
    }
  }
</script>

<section class="auth-stage" aria-label={t('title', undefined, 'auth')}>
  <form class="plate auth-card" onsubmit={handleSubmit}>
    <header class="auth-card__head">
      <div class="auth-card__mark-wrap">
        <BrandMark size="lg" />
        <span class="auth-card__brand">{siteTitle}</span>
      </div>
      <h2>{t('title', undefined, 'auth')}</h2>
      <p>{t('subtitle', undefined, 'auth')}</p>
    </header>

    <div class="auth-card__fields">
      <Field label={t('username', undefined, 'auth')} forId="pk-auth-user">
        <Input
          id="pk-auth-user"
          autocomplete="username"
          bind:value={username}
          placeholder={t('usernamePlaceholder', undefined, 'auth')}
          mono
        />
      </Field>

      <Field
        label={t('password', undefined, 'auth')}
        forId="pk-auth-pass"
        error={shownError || undefined}
      >
        <Input
          id="pk-auth-pass"
          type="password"
          autocomplete="current-password"
          bind:value={password}
          placeholder={t('passwordPlaceholder', undefined, 'auth')}
          invalid={Boolean(shownError)}
        />
      </Field>
    </div>

    <div class="auth-card__foot">
      <Button type="submit" variant="primary" fullWidth disabled={busy}>
        {busy ? t('submitting', undefined, 'auth') : t('submit', undefined, 'auth')}
      </Button>
    </div>
  </form>
</section>

<style>
  .auth-stage {
    min-height: calc(100dvh - 9rem);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem 1rem;
  }

  .auth-card {
    width: 100%;
    max-width: 24.5rem;
    padding: 1.75rem 1.75rem 1.625rem;
    display: flex;
    flex-direction: column;
    gap: 1.375rem;
  }

  .auth-card__head {
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.375rem;
    padding-bottom: 1.125rem;
    border-bottom: 1px solid var(--hairline);
  }

  .auth-card__mark-wrap {
    display: inline-flex;
    align-items: center;
    gap: 0.5625rem;
    margin-bottom: 0.25rem;
  }

  .auth-card__brand {
    font-size: 0.9375rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--ink-2);
  }

  .auth-card__head h2 {
    font-size: 1.1875rem;
    font-weight: 700;
    color: var(--ink);
  }

  .auth-card__head p {
    font-size: 0.75rem;
    color: var(--ink-3);
    line-height: 1.5;
    max-width: 20rem;
  }

  .auth-card__fields {
    display: flex;
    flex-direction: column;
    gap: 0.9375rem;
  }

  .auth-card__foot {
    padding-top: 0.25rem;
  }
</style>
