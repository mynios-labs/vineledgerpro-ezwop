// API tracing infrastructure for comprehensive request/response logging

export interface ApiTraceStep {
  step: string;
  method: string;
  url: string;
  timestamp: string;
  requestHeaders?: Record<string, string>;
  requestBody?: any;
  responseStatus?: number;
  responseHeaders?: Record<string, string>;
  responseBody?: any;
  correlationId?: string;
  error?: string;
  durationMs?: number;
}

export class ApiTracer {
  private steps: ApiTraceStep[] = [];
  private startTime: number = Date.now();

  async trace<T>(
    step: string,
    method: string,
    url: string,
    requestInit: RequestInit,
    executor: () => Promise<Response>,
    validator?: (data: any, response: Response) => string | null
  ): Promise<{ response: Response; data: T }> {
    const stepStartTime = Date.now();
    const traceStep: ApiTraceStep = {
      step,
      method,
      url,
      timestamp: new Date().toISOString(),
      requestHeaders: this.redactHeaders(requestInit.headers as Record<string, string>),
      requestBody: requestInit.body ? this.tryParseJson(requestInit.body as string) : undefined,
    };

    try {
      const response = await executor();
      const responseText = await response.text();
      const durationMs = Date.now() - stepStartTime;

      traceStep.responseStatus = response.status;
      traceStep.responseHeaders = this.redactHeaders(
        Object.fromEntries(response.headers.entries())
      );
      traceStep.responseBody = this.tryParseJson(responseText);
      traceStep.durationMs = durationMs;

      // Extract correlation ID if present
      const correlationId = response.headers.get('x-ebay-c-correlation-id') || 
                           response.headers.get('x-correlation-id');
      if (correlationId) {
        traceStep.correlationId = correlationId;
      }

      // Parse data
      let data: T;
      try {
        data = JSON.parse(responseText) as T;
      } catch {
        data = responseText as T;
      }

      // Check for logical failures (e.g., eBay errors[] in 200 OK response)
      if (validator) {
        const validationError = validator(data, response);
        if (validationError) {
          traceStep.error = validationError;
        }
      }

      this.steps.push(traceStep);

      // Re-create response with consumed text
      const clonedResponse = new Response(responseText, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });

      return { response: clonedResponse, data };
    } catch (error: any) {
      traceStep.error = error.message || String(error);
      traceStep.durationMs = Date.now() - stepStartTime;
      this.steps.push(traceStep);
      throw error;
    }
  }

  private tryParseJson(text: string): any {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private redactHeaders(headers: Record<string, string> | undefined): Record<string, string> {
    if (!headers) return {};
    
    const redacted = { ...headers };
    const sensitiveKeys = ['authorization', 'cookie', 'set-cookie', 'x-api-key'];
    
    for (const key of sensitiveKeys) {
      const lowerKey = key.toLowerCase();
      for (const headerKey in redacted) {
        if (headerKey.toLowerCase() === lowerKey) {
          redacted[headerKey] = '[REDACTED]';
        }
      }
    }
    
    return redacted;
  }

  getTrace(): ApiTraceStep[] {
    return this.steps;
  }

  getTotalDurationMs(): number {
    return Date.now() - this.startTime;
  }

  getLastStep(): ApiTraceStep | undefined {
    return this.steps[this.steps.length - 1];
  }

  hasErrors(): boolean {
    return this.steps.some(step => step.error || (step.responseStatus && step.responseStatus >= 400));
  }

  getFailedStep(): ApiTraceStep | undefined {
    return this.steps.find(step => step.error || (step.responseStatus && step.responseStatus >= 400));
  }
}
