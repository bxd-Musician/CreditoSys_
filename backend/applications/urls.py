# CreditoSys/backend/applications/urls.py
from django.urls import path
from .views import ApplicationListCreateView, ApplicationDetailView, ApplicationDocumentUploadView, ApplicationDocumentListView, UserStatsView, PolicyConfigView, EvaluatorStatsView, ApplicationDocumentDetailView

urlpatterns = [
    path('', ApplicationListCreateView.as_view(), name='application-list-create'),
    path('<int:pk>/', ApplicationDetailView.as_view(), name='application-detail'),
    path('<int:application_pk>/documents/', ApplicationDocumentListView.as_view(), name='application-documents-list'),
    path('<int:application_pk>/documents/upload/', ApplicationDocumentUploadView.as_view(), name='application-document-upload'),
    path('<int:application_pk>/documents/<int:pk>/', ApplicationDocumentDetailView.as_view(), name='application-document-detail'),
    path('user-stats/', UserStatsView.as_view(), name='user-stats'),
    path('policy-config/', PolicyConfigView.as_view(), name='policy-config'),
    path('evaluator-stats/', EvaluatorStatsView.as_view(), name='evaluator-stats'),
]