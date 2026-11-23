class ApiClient {
  private token: string | null = null;
  private unauthorizedHandler: (() => void) | null = null;

  setToken(token: string | null): void {
    this.token = token;
  }

  getToken(): string | null {
    return this.token;
  }

  onUnauthorized(handler: (() => void) | null): void {
    this.unauthorizedHandler = handler;
  }

  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers || {});
    headers.set('X-Requested-With', 'ExamAI');

    if (this.token) {
      headers.set('Authorization', `Bearer ${this.token}`);
    }

    if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const res = await fetch(path, {
      ...options,
      headers,
      credentials: 'include',
    });

    const contentType = res.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');
    const data = isJson ? await res.json() : await res.text();

    if (!res.ok) {
      const isAuthPath =
        path.startsWith('/api/auth/login') ||
        path.startsWith('/api/auth/register') ||
        path.startsWith('/api/auth/claim-admin') ||
        path.startsWith('/api/auth/demo-login') ||
        path.startsWith('/api/auth/forgot-password') ||
        path.startsWith('/api/auth/reset-password');

      if (res.status === 401 && !isAuthPath) {
        this.setToken(null);
        if (this.unauthorizedHandler) {
          this.unauthorizedHandler();
        }
      }

      const errorMsg =
        typeof data === 'object' && data && 'error' in data
          ? String((data as { error: unknown }).error)
          : res.status === 413
            ? 'Uploaded file is too large for the serverless request limit (max ~4.5 MB on Vercel).'
            : res.status === 404 && path.startsWith('/api/')
              ? 'Backend API route returned 404. Verify api/index.ts and vercel.json rewrites are deployed, or run the full-stack server.'
              : `Request failed with status ${res.status}`;
      throw new Error(errorMsg);
    }

    if (path.startsWith('/api/') && (!isJson || data === null || typeof data !== 'object')) {
      throw new Error(
        'Backend API returned a non-JSON response. Verify the serverless /api endpoint is deployed rather than static-only hosting.'
      );
    }

    return data as T;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' });
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'PATCH',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' });
  }
}

export const api = new ApiClient();
