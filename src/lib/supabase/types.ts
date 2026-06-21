// Tipos de la base de datos — generados desde el schema real de Supabase
// (proyecto "delpercio Project") y recortados a las 9 tablas del panel.
// Cada tabla incluye `Relationships` (requerido por supabase-js) y se mantiene
// `__InternalSupabase` para el tipado correcto de insert/update.
// Regenerar tras cambios de schema: ver README > "Cómo personalizar".

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "12.2.3 (519615d)";
  };
  public: {
    Tables: {
      profiles: {
        Row: { id: string; name: string; role: string; client_slug: string; created_at: string };
        Insert: { id?: string; name: string; role?: string; client_slug?: string; created_at?: string };
        Update: { id?: string; name?: string; role?: string; client_slug?: string; created_at?: string };
        Relationships: [];
      };
      events: {
        Row: {
          id: string;
          title: string;
          kind: string;
          announce_at: string | null;
          event_at: string | null;
          event_end_at: string | null;
          card_total: number | null;
          card_installments: number | null;
          transfer_price: number | null;
          international_price: number | null;
          details: string | null;
          landing_url: string | null;
          status: string;
          client_slug: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          kind: string;
          announce_at?: string | null;
          event_at?: string | null;
          event_end_at?: string | null;
          card_total?: number | null;
          card_installments?: number | null;
          transfer_price?: number | null;
          international_price?: number | null;
          details?: string | null;
          landing_url?: string | null;
          status?: string;
          client_slug?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          kind?: string;
          announce_at?: string | null;
          event_at?: string | null;
          event_end_at?: string | null;
          card_total?: number | null;
          card_installments?: number | null;
          transfer_price?: number | null;
          international_price?: number | null;
          details?: string | null;
          landing_url?: string | null;
          status?: string;
          client_slug?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      conversations: {
        Row: {
          id: string;
          display_name: string;
          source: string;
          external_id: string | null;
          wa_jid: string | null;
          status: string;
          mode: string;
          created_by: string | null;
          client_slug: string;
          simulated_timestamp: string | null;
          is_existing_customer: boolean;
          contact_email: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          display_name: string;
          source?: string;
          external_id?: string | null;
          wa_jid?: string | null;
          status?: string;
          mode?: string;
          created_by?: string | null;
          client_slug?: string;
          simulated_timestamp?: string | null;
          is_existing_customer?: boolean;
          contact_email?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string;
          source?: string;
          external_id?: string | null;
          wa_jid?: string | null;
          status?: string;
          mode?: string;
          created_by?: string | null;
          client_slug?: string;
          simulated_timestamp?: string | null;
          is_existing_customer?: boolean;
          contact_email?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      messages: {
        Row: {
          id: string;
          conversation_id: string;
          role: string;
          content: string;
          trace_id: string | null;
          delivered_at: string | null;
          attachment_path: string | null;
          attachment_type: string | null;
          external_id: string | null;
          client_slug: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          role: string;
          content: string;
          trace_id?: string | null;
          delivered_at?: string | null;
          attachment_path?: string | null;
          attachment_type?: string | null;
          external_id?: string | null;
          client_slug?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          role?: string;
          content?: string;
          trace_id?: string | null;
          delivered_at?: string | null;
          attachment_path?: string | null;
          attachment_type?: string | null;
          external_id?: string | null;
          client_slug?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      payment_validations: {
        Row: {
          id: string;
          conversation_id: string | null;
          message_id: string | null;
          comprobante_path: string | null;
          comprobante_type: string | null;
          sender_name: string | null;
          sender_tax_id: string | null;
          recipient_name: string | null;
          recipient_tax_id: string | null;
          amount: number | null;
          currency: string | null;
          transfer_date_raw: string | null;
          transferred_at: string | null;
          operation_number: string | null;
          bank_or_method: string | null;
          concept: string | null;
          extraction: Json | null;
          extraction_confidence: string | null;
          contact_name: string | null;
          contact_email: string | null;
          event_slug: string | null;
          status: string;
          awaiting_title: boolean;
          validated_by: string | null;
          validated_at: string | null;
          validation_note: string | null;
          client_slug: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          conversation_id?: string | null;
          message_id?: string | null;
          comprobante_path?: string | null;
          comprobante_type?: string | null;
          sender_name?: string | null;
          sender_tax_id?: string | null;
          recipient_name?: string | null;
          recipient_tax_id?: string | null;
          amount?: number | null;
          currency?: string | null;
          transfer_date_raw?: string | null;
          transferred_at?: string | null;
          operation_number?: string | null;
          bank_or_method?: string | null;
          concept?: string | null;
          extraction?: Json | null;
          extraction_confidence?: string | null;
          contact_name?: string | null;
          contact_email?: string | null;
          event_slug?: string | null;
          status?: string;
          awaiting_title?: boolean;
          validated_by?: string | null;
          validated_at?: string | null;
          validation_note?: string | null;
          client_slug?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          conversation_id?: string | null;
          message_id?: string | null;
          comprobante_path?: string | null;
          comprobante_type?: string | null;
          sender_name?: string | null;
          sender_tax_id?: string | null;
          recipient_name?: string | null;
          recipient_tax_id?: string | null;
          amount?: number | null;
          currency?: string | null;
          transfer_date_raw?: string | null;
          transferred_at?: string | null;
          operation_number?: string | null;
          bank_or_method?: string | null;
          concept?: string | null;
          extraction?: Json | null;
          extraction_confidence?: string | null;
          contact_name?: string | null;
          contact_email?: string | null;
          event_slug?: string | null;
          status?: string;
          awaiting_title?: boolean;
          validated_by?: string | null;
          validated_at?: string | null;
          validation_note?: string | null;
          client_slug?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      professional_titles: {
        Row: {
          id: string;
          conversation_id: string | null;
          message_id: string | null;
          file_path: string | null;
          file_type: string | null;
          holder_name: string | null;
          title_name: string | null;
          institution: string | null;
          confidence: string | null;
          extraction: Json | null;
          is_valid: boolean;
          validation_note: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          client_slug: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id?: string | null;
          message_id?: string | null;
          file_path?: string | null;
          file_type?: string | null;
          holder_name?: string | null;
          title_name?: string | null;
          institution?: string | null;
          confidence?: string | null;
          extraction?: Json | null;
          is_valid?: boolean;
          validation_note?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          client_slug?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          conversation_id?: string | null;
          message_id?: string | null;
          file_path?: string | null;
          file_type?: string | null;
          holder_name?: string | null;
          title_name?: string | null;
          institution?: string | null;
          confidence?: string | null;
          extraction?: Json | null;
          is_valid?: boolean;
          validation_note?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          client_slug?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      wa_connection_state: {
        Row: {
          client_slug: string;
          status: string;
          qr_string: string | null;
          phone: string | null;
          last_error: string | null;
          default_mode: string;
          updated_at: string;
        };
        Insert: {
          client_slug?: string;
          status?: string;
          qr_string?: string | null;
          phone?: string | null;
          last_error?: string | null;
          default_mode?: string;
          updated_at?: string;
        };
        Update: {
          client_slug?: string;
          status?: string;
          qr_string?: string | null;
          phone?: string | null;
          last_error?: string | null;
          default_mode?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      wa_outbox: {
        Row: {
          id: string;
          conversation_id: string;
          phone: string;
          content: string;
          sent_at: string | null;
          error: string | null;
          attempts: number;
          client_slug: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          phone: string;
          content: string;
          sent_at?: string | null;
          error?: string | null;
          attempts?: number;
          client_slug?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          phone?: string;
          content?: string;
          sent_at?: string | null;
          error?: string | null;
          attempts?: number;
          client_slug?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      agent_traces: {
        Row: {
          id: string;
          conversation_id: string;
          user_message_id: string | null;
          assistant_message_id: string | null;
          status: string;
          iterations: number;
          total_input_tokens: number;
          total_output_tokens: number;
          total_latency_ms: number;
          evaluator_passed: boolean | null;
          escalation_reason: string | null;
          provider: string;
          client_slug: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          user_message_id?: string | null;
          assistant_message_id?: string | null;
          status: string;
          iterations?: number;
          total_input_tokens?: number;
          total_output_tokens?: number;
          total_latency_ms?: number;
          evaluator_passed?: boolean | null;
          escalation_reason?: string | null;
          provider?: string;
          client_slug?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          user_message_id?: string | null;
          assistant_message_id?: string | null;
          status?: string;
          iterations?: number;
          total_input_tokens?: number;
          total_output_tokens?: number;
          total_latency_ms?: number;
          evaluator_passed?: boolean | null;
          escalation_reason?: string | null;
          provider?: string;
          client_slug?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      agent_trace_steps: {
        Row: {
          id: string;
          trace_id: string;
          step_order: number;
          step_type: string;
          step_name: string;
          iteration: number;
          model: string;
          provider: string;
          input: Json | null;
          output: Json | null;
          input_tokens: number;
          output_tokens: number;
          latency_ms: number;
          error: string | null;
          client_slug: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          trace_id: string;
          step_order: number;
          step_type: string;
          step_name: string;
          iteration?: number;
          model: string;
          provider: string;
          input?: Json | null;
          output?: Json | null;
          input_tokens?: number;
          output_tokens?: number;
          latency_ms?: number;
          error?: string | null;
          client_slug?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          trace_id?: string;
          step_order?: number;
          step_type?: string;
          step_name?: string;
          iteration?: number;
          model?: string;
          provider?: string;
          input?: Json | null;
          output?: Json | null;
          input_tokens?: number;
          output_tokens?: number;
          latency_ms?: number;
          error?: string | null;
          client_slug?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      agent_jobs: {
        Row: {
          id: string;
          conversation_id: string;
          user_message_id: string;
          status: string;
          attempts: number;
          max_attempts: number;
          error: string | null;
          trace_id: string | null;
          client_slug: string;
          created_at: string;
          started_at: string | null;
          completed_at: string | null;
          process_after: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          user_message_id: string;
          status?: string;
          attempts?: number;
          max_attempts?: number;
          error?: string | null;
          trace_id?: string | null;
          client_slug?: string;
          created_at?: string;
          started_at?: string | null;
          completed_at?: string | null;
          process_after?: string;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          user_message_id?: string;
          status?: string;
          attempts?: number;
          max_attempts?: number;
          error?: string | null;
          trace_id?: string | null;
          client_slug?: string;
          created_at?: string;
          started_at?: string | null;
          completed_at?: string | null;
          process_after?: string;
        };
        Relationships: [];
      };
      comments: {
        Row: {
          id: string;
          target_type: string;
          target_id: string;
          author_id: string;
          content: string;
          kind: string;
          client_slug: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          target_type: string;
          target_id: string;
          author_id: string;
          content: string;
          kind?: string;
          client_slug?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          target_type?: string;
          target_id?: string;
          author_id?: string;
          content?: string;
          kind?: string;
          client_slug?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      outbound_webhooks: {
        Row: {
          id: string;
          name: string;
          url: string;
          events: string[];
          secret: string | null;
          active: boolean;
          client_slug: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          url: string;
          events: string[];
          secret?: string | null;
          active?: boolean;
          client_slug?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          url?: string;
          events?: string[];
          secret?: string | null;
          active?: boolean;
          client_slug?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      agent_notifications: {
        Row: {
          id: string;
          conversation_id: string;
          trace_id: string | null;
          category: string;
          reason: string | null;
          summary: string | null;
          client_slug: string;
          created_at: string;
          resolved_at: string | null;
          resolved_by: string | null;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          trace_id?: string | null;
          category: string;
          reason?: string | null;
          summary?: string | null;
          client_slug?: string;
          created_at?: string;
          resolved_at?: string | null;
          resolved_by?: string | null;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          trace_id?: string | null;
          category?: string;
          reason?: string | null;
          summary?: string | null;
          client_slug?: string;
          created_at?: string;
          resolved_at?: string | null;
          resolved_by?: string | null;
        };
        Relationships: [];
      };
      outbound_webhook_deliveries: {
        Row: {
          id: string;
          webhook_id: string;
          event: string;
          payload: Json;
          response_status: number | null;
          response_body: string | null;
          delivered_at: string | null;
          client_slug: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          webhook_id: string;
          event: string;
          payload: Json;
          response_status?: number | null;
          response_body?: string | null;
          delivered_at?: string | null;
          client_slug?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          webhook_id?: string;
          event?: string;
          payload?: Json;
          response_status?: number | null;
          response_body?: string | null;
          delivered_at?: string | null;
          client_slug?: string;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      claim_agent_jobs: {
        Args: { p_limit: number };
        Returns: Database["public"]["Tables"]["agent_jobs"]["Row"][];
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

// Atajos de tipo por tabla.
type PublicTables = Database["public"]["Tables"];
export type Row<T extends keyof PublicTables> = PublicTables[T]["Row"];
export type Insert<T extends keyof PublicTables> = PublicTables[T]["Insert"];
export type Update<T extends keyof PublicTables> = PublicTables[T]["Update"];

export type Profile = Row<"profiles">;
export type Conversation = Row<"conversations">;
export type Message = Row<"messages">;
export type AgentTrace = Row<"agent_traces">;
export type AgentTraceStep = Row<"agent_trace_steps">;
export type AgentJob = Row<"agent_jobs">;
export type Comment = Row<"comments">;
export type AgentNotification = Row<"agent_notifications">;
export type OutboundWebhook = Row<"outbound_webhooks">;
export type OutboundWebhookDelivery = Row<"outbound_webhook_deliveries">;
export type WaConnectionState = Row<"wa_connection_state">;
export type WaOutbox = Row<"wa_outbox">;

// Uniones de valores cerrados (los CHECK constraints del schema).
export type ProfileRole = "dev" | "client" | "asesor";
export type ConversationSource = "test" | "whatsapp";
export type ConversationMode = "AI" | "HUMAN";
export type WaConnectionStatus = "disconnected" | "qr" | "connecting" | "connected";
export type MessageRole = "user" | "assistant" | "system" | "human";
export type TraceStatus = "running" | "completed" | "escalated" | "failed";
export type StepType = "orchestrator" | "subagent" | "tool" | "evaluator";
export type JobStatus = "pending" | "processing" | "completed" | "failed";
export type CommentTargetType = "conversation" | "message";
/**
 * Tipo de comentario. `positive`/`negative` son reacciones unicas por
 * (target, autor) — son toggle (clic ya activo = borra). `note` es texto
 * libre y puede repetirse.
 */
export type CommentKind = "positive" | "negative" | "note";
export type Provider = "anthropic" | "openrouter";
/**
 * Categoría de una notificación al equipo. Texto libre en snake_case: cada
 * cliente define sus propias categorías en el prompt del orquestador. El
 * worker tiene etiquetas legibles para las comunes y un fallback que
 * humaniza el snake_case.
 */
export type NotificationCategory = string;
