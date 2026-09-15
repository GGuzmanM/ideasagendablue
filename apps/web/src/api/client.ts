import { useAuthStore } from '../stores/authStore';

const BASE = '/api/v1';

interface CuerpoError { message?: string; error?: string; details?: { campo: string; mensaje: string }[] }

// Mensaje que ve el usuario cuando algo falla. Los del API ya vienen en español; los que no dicen nada
// («Datos inválidos», 500, sin conexión) se traducen a algo que una persona sin conocimientos técnicos entienda.
function mensajeDeError(status: number, err: CuerpoError | null): string {
  if (!err) return 'No hay conexión con el sistema. Revisa el wifi de la tablet e inténtalo de nuevo.';
  if (status === 422 && err.details?.length) {
    const campos = err.details.slice(0, 3).map((d) => `${d.campo || 'dato'}: ${d.mensaje}`).join(' · ');
    return `Revisa lo que escribiste (${campos}).`;
  }
  if (status >= 500) return 'Algo falló al guardar. Inténtalo de nuevo; si sigue igual, avisa a Sistemas.';
  return err.message ?? err.error ?? 'No se pudo completar la acción.';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = useAuthStore.getState().token;
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw Object.assign(new Error(mensajeDeError(0, null)), { statusCode: 0, data: null });
  }

  if (!res.ok) {
    if (res.status === 401) {
      useAuthStore.getState().logout();
      window.location.href = '/login';
    }
    const err = (await res.json().catch(() => null)) as CuerpoError | null;
    throw Object.assign(new Error(mensajeDeError(res.status, err)), { statusCode: res.status, data: err });
  }

  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string, params?: Record<string, string>) => {
    const url = params
      ? `${path}?${new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v != null))).toString()}`
      : path;
    return request<T>(url);
  },
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body), headers }),
  upload: async <T>(path: string, formData: FormData): Promise<T> => {
    const token = useAuthStore.getState().token;
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      body: formData,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    if (!res.ok) {
      if (res.status === 401) {
        useAuthStore.getState().logout();
        window.location.href = '/login';
      }
      const err = (await res.json().catch(() => null)) as CuerpoError | null;
      throw Object.assign(new Error(mensajeDeError(res.status, err)), { statusCode: res.status, data: err });
    }

    return res.json() as Promise<T>;
  },
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  // `body` opcional: p. ej. el motivo al eliminar una nota o un diagnóstico (queda en la auditoría).
  delete: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'DELETE', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }),
};
