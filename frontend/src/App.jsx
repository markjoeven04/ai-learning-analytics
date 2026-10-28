import { Routes, Route } from "react-router-dom";
import Login from "./pages/Login";
import StudentDashboard from "./pages/StudentDashboard";
import InstructorDashboard from "./pages/InstructorDashboard";
import AdminDashboard from "./pages/AdminDashboard";
import ProgramDirectorDashboard from "./pages/ProgramDirectorDashboard";
import DeanDashboard from "./pages/DeanDashboard";
import VPDashboard from "./pages/VPDashboard";
import ProcessingInterface from "./pages/ProcessingInterface";
import AnalyticsPage from "./pages/AnalyticsPage";
import NotFound from "./pages/NotFound";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import UserManagement from "./pages/UserManagement";
import TopicMappingPage from "./pages/TopicMappingPage";
import MyCoursesPage from "./pages/MyCoursesPage";
import MyClassesPage from "./pages/MyClassesPage";
import InterventionAlertsPage from "./pages/InterventionAlertsPage";
import StudentCompetenciesPage from "./pages/StudentCompetenciesPage";
import StudentInterventionsPage from "./pages/StudentInterventionsPage";
import ResourcesPage from "./pages/ResourcesPage";
import CourseResourcesPage from "./pages/CourseResourcesPage";
import ReportsPage from "./pages/ReportsPage";
import InstitutionSettingsPage from "./pages/InstitutionSettingsPage";
import MappingValidationPage from "./pages/MappingValidationPage";
import SettingsPage from "./pages/SettingsPage";
import CurriculumInsightsPage from "./pages/CurriculumInsightsPage";
import AuditLogsPage from "./pages/AuditLogsPage";
import ProgramsPage from "./pages/ProgramsPage";
import CurriculaPage from "./pages/CurriculaPage";
import SectionsPage from "./pages/SectionsPage";
import EnrollmentPage from "./pages/EnrollmentPage";
import SyllabusApprovalQueue from "./pages/SyllabusApprovalQueue";
import AssessmentApprovalQueue from "./pages/AssessmentApprovalQueue";
import GradeSubmissionPage from "./pages/GradeSubmissionPage";
import GradeApprovalQueue from "./pages/GradeApprovalQueue";
import MySyllabiPage from "./pages/MySyllabiPage";
import AttendancePage from "./pages/AttendancePage";
import GradeConsultationPage from "./pages/GradeConsultationPage";
import SusSurveyPage from "./pages/SusSurveyPage";
import LandingPage from "./pages/LandingPage";
import ConsentPage from "./pages/ConsentPage";
import Unauthorized from "./pages/Unauthorized";
import ProtectedRoute from "./components/ProtectedRoute";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<Login />} />
      <Route path="/consent" element={<ProtectedRoute allowedRoles={["student"]}><ConsentPage /></ProtectedRoute>} />

      <Route path="/student" element={<ProtectedRoute allowedRoles={["student"]}><StudentDashboard /></ProtectedRoute>} />

      <Route path="/instructor" element={<ProtectedRoute allowedRoles={["instructor"]}><InstructorDashboard /></ProtectedRoute>} />
      <Route path="/instructor/processing" element={<ProtectedRoute allowedRoles={["instructor"]}><ProcessingInterface /></ProtectedRoute>} />
      <Route path="/instructor/my-syllabi" element={<ProtectedRoute allowedRoles={["instructor"]}><MySyllabiPage /></ProtectedRoute>} />

      <Route path="/admin" element={<ProtectedRoute allowedRoles={["admin"]}><AdminDashboard /></ProtectedRoute>} />
      <Route path="/admin/processing" element={<ProtectedRoute allowedRoles={["admin"]}><ProcessingInterface /></ProtectedRoute>} />

      <Route path="/program-director" element={<ProtectedRoute allowedRoles={["program_director"]}><ProgramDirectorDashboard /></ProtectedRoute>} />
      <Route path="/dean" element={<ProtectedRoute allowedRoles={["dean"]}><DeanDashboard /></ProtectedRoute>} />
      <Route path="/vp" element={<ProtectedRoute allowedRoles={["vp_academic_affairs"]}><VPDashboard /></ProtectedRoute>} />
      <Route path="/syllabus-approval" element={<ProtectedRoute allowedRoles={["program_director","dean","vp_academic_affairs"]}><SyllabusApprovalQueue /></ProtectedRoute>} />
      <Route path="/assessment-approval" element={<ProtectedRoute allowedRoles={["program_director"]}><AssessmentApprovalQueue /></ProtectedRoute>} />
      <Route path="/grade-approval" element={<ProtectedRoute allowedRoles={["program_director","dean","vp_academic_affairs"]}><GradeApprovalQueue /></ProtectedRoute>} />
      <Route path="/instructor/grade-submissions" element={<ProtectedRoute allowedRoles={["instructor"]}><GradeSubmissionPage /></ProtectedRoute>} />
      <Route path="/instructor/attendance" element={<ProtectedRoute allowedRoles={["instructor"]}><AttendancePage /></ProtectedRoute>} />
      <Route path="/instructor/grade-consultation" element={<ProtectedRoute allowedRoles={["instructor"]}><GradeConsultationPage /></ProtectedRoute>} />

      <Route path="/analytics-page" element={<ProtectedRoute allowedRoles={["admin","instructor"]}><AnalyticsPage /></ProtectedRoute>} />
      <Route path="/topic-mapping" element={<ProtectedRoute allowedRoles={["instructor","admin"]}><TopicMappingPage /></ProtectedRoute>} />
      <Route path="/my-courses" element={<ProtectedRoute allowedRoles={["student"]}><MyCoursesPage /></ProtectedRoute>} />
      <Route path="/my-classes" element={<ProtectedRoute allowedRoles={["instructor"]}><MyClassesPage /></ProtectedRoute>} />
      <Route path="/intervention-alerts" element={<ProtectedRoute allowedRoles={["instructor"]}><InterventionAlertsPage /></ProtectedRoute>} />
      <Route path="/my-competencies" element={<ProtectedRoute allowedRoles={["student"]}><StudentCompetenciesPage /></ProtectedRoute>} />
      <Route path="/interventions" element={<ProtectedRoute allowedRoles={["student"]}><StudentInterventionsPage /></ProtectedRoute>} />
      <Route path="/user-management" element={<ProtectedRoute allowedRoles={["admin","instructor"]}><UserManagement /></ProtectedRoute>} />
      <Route path="/mapping-validation" element={<ProtectedRoute allowedRoles={["admin","instructor","program_director","dean","vp_academic_affairs"]}><MappingValidationPage /></ProtectedRoute>} />
      <Route path="/institution-settings" element={<ProtectedRoute allowedRoles={["admin","program_director","dean","vp_academic_affairs"]}><InstitutionSettingsPage /></ProtectedRoute>} />
      <Route path="/reports" element={<ProtectedRoute allowedRoles={["admin","instructor","program_director","dean","vp_academic_affairs"]}><ReportsPage /></ProtectedRoute>} />
      <Route path="/instructor/course-resources" element={<ProtectedRoute allowedRoles={["instructor","admin"]}><CourseResourcesPage /></ProtectedRoute>} />
      <Route path="/resource-library" element={<ProtectedRoute allowedRoles={["admin","instructor"]}><ResourcesPage /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute allowedRoles={["student","instructor","admin","program_director","dean","vp_academic_affairs"]}><SettingsPage /></ProtectedRoute>} />
      <Route path="/audit-logs" element={<ProtectedRoute allowedRoles={["admin"]}><AuditLogsPage /></ProtectedRoute>} />
      <Route path="/admin/programs" element={<ProtectedRoute allowedRoles={["admin"]}><ProgramsPage /></ProtectedRoute>} />
      <Route path="/admin/curricula" element={<ProtectedRoute allowedRoles={["admin"]}><CurriculaPage /></ProtectedRoute>} />
      <Route path="/admin/sections" element={<ProtectedRoute allowedRoles={["admin"]}><SectionsPage /></ProtectedRoute>} />
      <Route path="/admin/enrollment" element={<ProtectedRoute allowedRoles={["admin"]}><EnrollmentPage /></ProtectedRoute>} />
      <Route path="/sus-survey" element={<ProtectedRoute allowedRoles={["student","instructor","admin"]}><SusSurveyPage /></ProtectedRoute>} />
      <Route path="/privacy" element={<PrivacyPolicy />} />
      <Route path="/unauthorized" element={<Unauthorized />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
