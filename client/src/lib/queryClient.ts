import { QueryClient, QueryFunction } from "@tanstack/react-query";

export class ApiError extends Error {
  constructor(
    public status: number,
    public data: any,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function getApiErrorPayload(error: unknown): { title: string; description: string } {
  if (error instanceof ApiError && error.data) {
    return {
      title: error.data.error || 'Error',
      description: error.data.message || error.message || 'An error occurred'
    };
  }
  
  if (error instanceof Error) {
    return {
      title: 'Error',
      description: error.message
    };
  }
  
  return {
    title: 'Error',
    description: 'An unknown error occurred'
  };
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    
    // Try to parse JSON response
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      // Not JSON, use text as-is
    }
    
    const message = data?.message || data?.error || text || res.statusText;
    throw new ApiError(res.status, data, message);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<any> {
  const isFormData = data instanceof FormData;
  
  const res = await fetch(url, {
    method,
    headers: !isFormData && data ? { "Content-Type": "application/json" } : {},
    body: isFormData ? data : (data ? JSON.stringify(data) : undefined),
    credentials: "include",
  });

  await throwIfResNotOk(res);
  
  const contentType = res.headers.get("content-type");
  if (contentType && contentType.includes("application/json")) {
    return res.json();
  }
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
