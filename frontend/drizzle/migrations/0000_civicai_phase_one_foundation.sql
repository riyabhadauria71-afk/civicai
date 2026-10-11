CREATE TYPE public.app_role AS ENUM ('citizen', 'officer', 'admin');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  display_name text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users can create their own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own assigned roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  description text,
  category text,
  media_path text NOT NULL,
  media_mime text NOT NULL,
  latitude double precision,
  longitude double precision,
  status text NOT NULL DEFAULT 'REPORTED' CHECK (status IN ('REPORTED', 'AI_ANALYZED', 'VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.reports TO authenticated;
GRANT ALL ON public.reports TO service_role;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Citizens can view their own reports" ON public.reports FOR SELECT TO authenticated USING (auth.uid() = reporter_id);
CREATE POLICY "Citizens can submit their own reports" ON public.reports FOR INSERT TO authenticated WITH CHECK (auth.uid() = reporter_id);
CREATE INDEX reports_reporter_created_idx ON public.reports (reporter_id, created_at DESC);
CREATE INDEX reports_status_created_idx ON public.reports (status, created_at DESC);

CREATE TABLE public.ai_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  predicted_category text NOT NULL,
  confidence double precision NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  detections jsonb NOT NULL DEFAULT '[]'::jsonb,
  severity text CHECK (severity IS NULL OR severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  priority text CHECK (priority IS NULL OR priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
  model_version text,
  requires_human_review boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_analyses TO authenticated;
GRANT ALL ON public.ai_analyses TO service_role;
ALTER TABLE public.ai_analyses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Citizens can view analyses of their own reports" ON public.ai_analyses FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.reports WHERE reports.id = ai_analyses.report_id AND reports.reporter_id = auth.uid()));
CREATE INDEX ai_analyses_report_created_idx ON public.ai_analyses (report_id, created_at DESC);

CREATE TABLE public.report_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  previous_status text,
  new_status text NOT NULL CHECK (new_status IN ('REPORTED', 'AI_ANALYZED', 'VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'REJECTED')),
  changed_by uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.report_status_history TO authenticated;
GRANT ALL ON public.report_status_history TO service_role;
ALTER TABLE public.report_status_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Citizens can view status history of their own reports" ON public.report_status_history FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.reports WHERE reports.id = report_status_history.report_id AND reports.reporter_id = auth.uid()));
CREATE INDEX report_status_history_report_created_idx ON public.report_status_history (report_id, created_at DESC);

CREATE TABLE public.ai_model_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  original_prediction text NOT NULL,
  confidence double precision CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  corrected_category text NOT NULL,
  corrected_by uuid,
  media_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_model_feedback TO authenticated;
GRANT ALL ON public.ai_model_feedback TO service_role;
ALTER TABLE public.ai_model_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Citizens can view feedback of their own reports" ON public.ai_model_feedback FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.reports WHERE reports.id = ai_model_feedback.report_id AND reports.reporter_id = auth.uid()));
CREATE INDEX ai_model_feedback_report_created_idx ON public.ai_model_feedback (report_id, created_at DESC);

CREATE POLICY "Authenticated users upload civic media to their own folder" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'civic-media' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Authenticated users read civic media in their own folder" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'civic-media' AND (storage.foldername(name))[1] = auth.uid()::text);