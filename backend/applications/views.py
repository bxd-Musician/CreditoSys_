from rest_framework import generics, status, filters
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated # IsAdminUser no se usa directamente en este archivo, pero no hay problema si está
from django_filters.rest_framework import DjangoFilterBackend
from django.db import models
from .models import Application, ApplicationDocument
from .serializers import ApplicationSerializer, ApplicationUpdateSerializer, ApplicationDocumentSerializer
from .permissions import IsClientOrAdminOrEvaluator, IsOwnerOrAdminOrEvaluator
from rest_framework.parsers import MultiPartParser, FormParser
from django.http import Http404
from rest_framework.exceptions import PermissionDenied
from rest_framework.views import APIView
from django.db.models import Count, Sum, Avg
from django.utils import timezone
from datetime import timedelta
from rest_framework.permissions import IsAdminUser
from .models import PolicyConfig
from .serializers import PolicyConfigSerializer
from users.models import AdminLog
import logging

class ApplicationListCreateView(generics.ListCreateAPIView):
    serializer_class = ApplicationSerializer
    permission_classes = [IsAuthenticated, IsClientOrAdminOrEvaluator] # Permisos personalizados
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['status', 'application_date', 'client__username', 'client__email'] # Campos para filtrar
    search_fields = ['purpose', 'client__username', 'client__email'] # Campos para búsqueda
    ordering_fields = ['application_date', 'amount', 'status'] # Campos para ordenar

    def get_queryset(self):
        user = self.request.user
        if user.is_staff or user.role == 'admin' or user.role == 'evaluador':
            # Admin/Evaluador/Staff pueden ver todas las solicitudes
            return Application.objects.all()
        # Clientes solo pueden ver sus propias solicitudes
        return Application.objects.filter(client=user)

    def perform_create(self, serializer):
        # Asignar el cliente automáticamente al usuario autenticado
        serializer.save(client=self.request.user, status='pendiente')

class ApplicationDetailView(generics.RetrieveUpdateDestroyAPIView):
    queryset = Application.objects.all()
    serializer_class = ApplicationSerializer
    permission_classes = [IsAuthenticated, IsOwnerOrAdminOrEvaluator] # Permisos personalizados

    def get_serializer_class(self):
        # Permitir que evaluadores/admins actualicen solo ciertos campos
        if self.request.method in ['PUT', 'PATCH'] and (self.request.user.role == 'admin' or self.request.user.role == 'evaluador'):
            return ApplicationUpdateSerializer
        return ApplicationSerializer

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer_class = self.get_serializer_class()
        partial = kwargs.pop('partial', True)
        serializer = serializer_class(instance, data=request.data, partial=partial)

        if serializer.is_valid():
            evaluated_by_id = request.data.get('evaluated_by')
            evaluated_at = request.data.get('evaluated_at')
            print(f"PATCH recibido: evaluated_by_id={evaluated_by_id}, evaluated_at={evaluated_at}")
            if evaluated_by_id:
                from django.contrib.auth import get_user_model
                User = get_user_model()
                try:
                    instance.evaluated_by = User.objects.get(pk=evaluated_by_id)
                    print(f"Asignado evaluated_by: {instance.evaluated_by}")
                except User.DoesNotExist:
                    print("Evaluador no encontrado")
            if evaluated_at:
                from django.utils.dateparse import parse_datetime
                instance.evaluated_at = parse_datetime(evaluated_at)
                print(f"Asignado evaluated_at: {instance.evaluated_at}")
            serializer.save()
            instance.save()
            print(f"Solicitud actualizada: {instance.id}, evaluated_by={instance.evaluated_by}, evaluated_at={instance.evaluated_at}")
            return Response(serializer.data)
        print("Errores en el serializer:", serializer.errors)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    # Nota: No permitir DELETE por ahora para solicitudes de crédito, o con permisos muy restringidos.
    # Si quieres permitirlo:
    # def destroy(self, request, *args, **kwargs):
    #     instance = self.get_object()
    #     if request.user.role != 'admin': # Solo admins pueden eliminar
    #         return Response({"detail": "No tiene permiso para eliminar esta solicitud."}, status=status.HTTP_403_FORBIDDEN)
    #     self.perform_destroy(instance)
    #     return Response(status=status.HTTP_204_NO_CONTENT)


class ApplicationDocumentUploadView(generics.CreateAPIView):
    queryset = ApplicationDocument.objects.all()
    serializer_class = ApplicationDocumentSerializer
    parser_classes = (MultiPartParser, FormParser) # Para manejar subidas de archivos
    permission_classes = [IsAuthenticated, IsOwnerOrAdminOrEvaluator] # Solo el propietario o admin/evaluador

    def perform_create(self, serializer):
        # Asegurarse de que la solicitud exista y el usuario tenga permisos sobre ella
        application_id = self.kwargs.get('application_pk') # Obtener ID de la URL
        try:
            application = Application.objects.get(pk=application_id)
            # Verificar si el usuario es el propietario o admin/evaluador
            if self.request.user != application.client and not (self.request.user.role in ['admin', 'evaluador']):
                 raise PermissionDenied("No tiene permiso para añadir documentos a esta solicitud.")
            serializer.save(application=application)
        except Application.DoesNotExist:
            raise Http404("La solicitud no existe.")
        except PermissionDenied as e:
            raise e # Re-lanzar la excepción de permiso denegado


class ApplicationDocumentListView(generics.ListAPIView):
    serializer_class = ApplicationDocumentSerializer
    permission_classes = [IsAuthenticated, IsOwnerOrAdminOrEvaluator]

    def get_queryset(self):
        application_id = self.kwargs.get('application_pk')
        try:
            application = Application.objects.get(pk=application_id)
            # Verificar permisos
            if self.request.user != application.client and not (self.request.user.role in ['admin', 'evaluador']):
                raise PermissionDenied("No tiene permiso para ver documentos de esta solicitud.")
            return ApplicationDocument.objects.filter(application=application)
        except Application.DoesNotExist:
            raise Http404("La solicitud no existe.")


class ApplicationDocumentDetailView(generics.RetrieveUpdateAPIView):
    queryset = ApplicationDocument.objects.all()
    serializer_class = ApplicationDocumentSerializer
    permission_classes = [IsAuthenticated, IsOwnerOrAdminOrEvaluator]

    def get_queryset(self):
        application_id = self.kwargs.get('application_pk')
        return ApplicationDocument.objects.filter(application_id=application_id)

    def get_object(self):
        application_id = self.kwargs.get('application_pk')
        doc_id = self.kwargs.get('pk')
        logger = logging.getLogger('django')
        logger.info(f"[DEBUG] Buscando documento: application_id={application_id}, doc_id={doc_id}")
        try:
            doc = ApplicationDocument.objects.get(pk=doc_id, application_id=application_id)
            logger.info(f"[DEBUG] Documento encontrado: {doc}")
            return doc
        except ApplicationDocument.DoesNotExist:
            logger.error(f"[DEBUG] Documento NO encontrado: application_id={application_id}, doc_id={doc_id}")
            raise Http404("El documento no existe para esta solicitud.")


class UserStatsView(APIView):
    permission_classes = [IsAuthenticated]
    
    def get(self, request):
        user = request.user
        
        # Obtener todas las solicitudes del usuario
        user_applications = Application.objects.filter(client=user)
        
        # Estadísticas básicas
        total_applications = user_applications.count()
        
        # Estadísticas por estado
        status_stats = user_applications.values('status').annotate(
            count=Count('id')
        ).order_by('status')
        
        # Monto total solicitado
        total_amount_requested = user_applications.aggregate(
            total=Sum('amount')
        )['total'] or 0
        
        # Monto promedio por solicitud
        avg_amount = user_applications.aggregate(
            avg=Avg('amount')
        )['avg'] or 0
        
        # Solicitudes de los últimos 30 días
        thirty_days_ago = timezone.now() - timedelta(days=30)
        recent_applications = user_applications.filter(
            application_date__gte=thirty_days_ago
        ).count()
        
        # Solicitudes aprobadas
        approved_applications = user_applications.filter(status='aprobada').count()
        
        # Solicitudes desembolsadas
        disbursed_applications = user_applications.filter(status='desembolsada').count()
        
        # Solicitudes rechazadas
        rejected_applications = user_applications.filter(status='rechazada').count()
        
        # Monto total desembolsado
        total_disbursed = user_applications.filter(status='desembolsada').aggregate(
            total=Sum('amount')
        )['total'] or 0
        
        # Score crediticio promedio (si existe)
        avg_credit_score = user_applications.exclude(credit_score__isnull=True).aggregate(
            avg=Avg('credit_score')
        )['avg'] or 0
        
        stats = {
            'total_applications': total_applications,
            'status_breakdown': list(status_stats),
            'total_amount_requested': float(total_amount_requested),
            'average_amount': float(avg_amount),
            'recent_applications_30_days': recent_applications,
            'approved_applications': approved_applications,
            'rejected_applications': rejected_applications,
            'disbursed_applications': disbursed_applications,
            'total_disbursed_amount': float(total_disbursed),
            'average_credit_score': float(avg_credit_score),
            'approval_rate': (approved_applications / total_applications * 100) if total_applications > 0 else 0,
            'disbursement_rate': (disbursed_applications / total_applications * 100) if total_applications > 0 else 0,
        }
        
        return Response(stats)

class PolicyConfigView(APIView):
    permission_classes = [IsAdminUser]
    
    def get(self, request):
        """Obtener la configuración actual de políticas"""
        try:
            # Obtener la política activa más reciente
            policy = PolicyConfig.objects.filter(activo=True).order_by('-fecha_actualizacion').first()
            
            if not policy:
                # Crear política por defecto si no existe
                policy = PolicyConfig.objects.create(
                    creado_por=request.user,
                    activo=True
                )
            
            serializer = PolicyConfigSerializer(policy)
            return Response(serializer.data)
            
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    
    def post(self, request):
        """Actualizar la configuración de políticas"""
        try:
            # Obtener política actual
            current_policy = PolicyConfig.objects.filter(activo=True).order_by('-fecha_actualizacion').first()
            
            # Validar que la suma de ponderaciones sea 100%
            ponderaciones = request.data.get('ponderaciones', {})
            total_ponderacion = sum(ponderaciones.values())
            
            if total_ponderacion != 100:
                return Response({
                    'error': f'La suma de ponderaciones debe ser 100%. Actual: {total_ponderacion}%'
                }, status=status.HTTP_400_BAD_REQUEST)
            
            # Validar umbrales
            umbrales = request.data.get('umbrales', {})
            if umbrales.get('score_minimo_aprobacion', 0) < umbrales.get('score_minimo_revision', 0):
                return Response({
                    'error': 'El score mínimo de aprobación debe ser mayor al de revisión'
                }, status=status.HTTP_400_BAD_REQUEST)
            
            # Preparar datos para el serializer
            policy_data = {
                'score_minimo_aprobacion': umbrales.get('score_minimo_aprobacion', 70),
                'score_minimo_revision': umbrales.get('score_minimo_revision', 50),
                'monto_maximo_aprobacion': umbrales.get('monto_maximo_aprobacion', 100000),
                'peso_historial_crediticio': ponderaciones.get('historial_crediticio', 40),
                'peso_ingresos_deuda': ponderaciones.get('ingresos_deuda', 30),
                'peso_activos': ponderaciones.get('activos', 20),
                'peso_comportamiento': ponderaciones.get('comportamiento', 10),
                'requiere_recibos_sueldo': request.data.get('documentos', {}).get('requiere_recibos_sueldo', True),
                'requiere_historial_crediticio': request.data.get('documentos', {}).get('requiere_historial_crediticio', True),
                'requiere_declaracion_renta': request.data.get('documentos', {}).get('requiere_declaracion_renta', False),
                'requiere_estados_cuenta': request.data.get('documentos', {}).get('requiere_estados_cuenta', False),
                'requiere_escrituras_propiedad': request.data.get('documentos', {}).get('requiere_escrituras_propiedad', False),
                'tiempo_maximo_validacion': request.data.get('validacion', {}).get('tiempo_maximo_validacion', 3),
                'tamano_maximo_archivo': request.data.get('validacion', {}).get('tamano_maximo_archivo', 50),
            }
            
            if current_policy:
                # Actualizar política existente
                serializer = PolicyConfigSerializer(current_policy, data=policy_data, context={'request': request})
            else:
                # Crear nueva política
                serializer = PolicyConfigSerializer(data=policy_data, context={'request': request})
            
            if serializer.is_valid():
                policy = serializer.save()
                
                # Registrar evento en AdminLog
                AdminLog.objects.create(
                    tipo='politica_actualizada',
                    titulo='Políticas Crediticias Actualizadas',
                    detalle=f"Umbral aprobación: {policy.score_minimo_aprobacion}%, Revisión: {policy.score_minimo_revision}%"
                )
                
                return Response({
                    'message': 'Políticas actualizadas exitosamente',
                    'policy': serializer.data
                })
            else:
                return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
                
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

# REEMPLAZA ESTE MÉTODO COMPLETO en tu archivo backend/applications/views.py

class EvaluatorStatsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        if not hasattr(user, 'role') or user.role not in ['evaluador', 'admin']:
            return Response({'error': 'No tiene permisos para ver estas estadísticas.'}, status=403)

        now = timezone.now()
        today = now.date()

        # CORRECTO: Cuenta todas las solicitudes pendientes, sin importar el evaluador.
        pendientes = Application.objects.filter(status__in=['pendiente', 'en_revision']).count()

        # CORRECTO: Cuenta TODAS las solicitudes finalizadas (aprobadas/rechazadas) en el día de hoy,
        # sin importar qué evaluador lo hizo.
        evaluadas_hoy = Application.objects.filter(
            evaluated_at__date=today,
            status__in=['aprobada', 'rechazada']
        ).count()

        # CORRECTO: Calcula la tasa de aprobación sobre TODAS las solicitudes finalizadas.
        total_evaluadas = Application.objects.filter(status__in=['aprobada', 'rechazada']).count()
        aprobadas = Application.objects.filter(status='aprobada').count()
        tasa_aprobacion = (aprobadas / total_evaluadas * 100) if total_evaluadas > 0 else 0

        # Mantenemos tu lógica de tiempo promedio si existe
        tiempo_promedio = 0
        if hasattr(Application, 'application_date') and hasattr(Application, 'evaluated_at'):
             evaluadas_con_tiempo = Application.objects.filter(
                status__in=['aprobada', 'rechazada'], 
                evaluated_at__isnull=False
            ).annotate(
                processing_time=models.ExpressionWrapper(
                    models.F('evaluated_at') - models.F('application_date'), 
                    output_field=models.DurationField()
                )
            )
             
             avg_duration = evaluadas_con_tiempo.aggregate(avg_time=Avg('processing_time'))['avg_time']
             if avg_duration:
                 tiempo_promedio = avg_duration.total_seconds() / 60 # Convertir a minutos

        return Response({
            'pendientes': pendientes,
            'evaluadas_hoy': evaluadas_hoy,
            'tasa_aprobacion': round(tasa_aprobacion, 2),
            'tiempo_promedio': round(tiempo_promedio, 2),
            'aprobaciones': aprobadas # Dato útil para la pestaña de reportes
        })