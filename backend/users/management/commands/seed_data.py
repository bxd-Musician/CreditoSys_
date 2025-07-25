# /backend/users/management/commands/seed_data.py

import random
from decimal import Decimal
from django.core.management.base import BaseCommand
from django.utils import timezone
from datetime import timedelta

# Importamos tus modelos desde sus respectivas apps
from users.models import User
from applications.models import Application

# --- Listas de datos para generar nombres realistas SIN FAKER ---
NOMBRES = ['Juan', 'Carlos', 'Maria', 'Ana', 'Luis', 'Jose', 'Sofia', 'Camila', 'Andres', 'Diego', 'Lucia', 'Valentina']
APELLIDOS = ['Garcia', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Perez', 'Sanchez', 'Ramirez', 'Torres']
COMENTARIOS_EJEMPLO = [
    'Cliente con buen historial, se recomienda proceder.',
    'Verificar consistencia de ingresos declarados.',
    'Solicitud de alto riesgo debido a endeudamiento previo.',
    'Documentación completa y en orden.',
    'Primer crédito, evaluar con cautela pero muestra buen potencial.'
]

class Command(BaseCommand):
    help = 'Puebla la base de datos con una carga masiva y realista de datos de prueba, sin usar Faker.'

    def handle(self, *args, **kwargs):
        self.stdout.write(self.style.SUCCESS('--- INICIANDO CARGA MASIVA DE DATOS v3.0 (Sin Faker) ---'))

        # --- 1. LIMPIEZA DE LA BASE DE DATOS ---
        self.stdout.write('Paso 1/5: Limpiando datos de prueba anteriores...')
        Application.objects.all().delete()
        User.objects.filter(is_superuser=False).delete()

        # --- 2. CREACIÓN DE ROLES CLAVE (ADMIN Y EVALUADORES) ---
        self.stdout.write('Paso 2/5: Creando usuarios de sistema (Admin y Evaluadores)...')
        User.objects.create_superuser('admin', 'admin@creditosys.com', 'adminpass')
        
        evaluadores = []
        for i in range(1, 6): # Crear 5 evaluadores
            nombre = random.choice(NOMBRES)
            apellido = random.choice(APELLIDOS)
            evaluador = User.objects.create_user(
                username=f'evaluador{i}', email=f'evaluador{i}@creditosys.com', 
                password='password123', role='evaluador',
                first_name=nombre, last_name=apellido, dni=str(random.randint(10000000, 99999999))
            )
            evaluadores.append(evaluador)
        self.stdout.write(self.style.SUCCESS(f'Se crearon 1 admin y {len(evaluadores)} evaluadores.'))

        # --- 3. DATOS ESPECÍFICOS DEL PROTOTIPO ---
        self.stdout.write('Paso 3/5: Creando los 3 casos de prueba específicos...')
        # (El código para los 3 usuarios específicos se mantiene igual)
        datos_especificos = [
            {'id': '004', 'monto': 50000, 'plazo': 60, 'propósito': 'Ampliación de Negocio', 'cliente': {'nombre': 'Ana Torres', 'dni': '12345678', 'score': 640}, 'prediccion': 'Riesgo Medio', 'sugerencia': 'Score menor a 650 en "Negocio" tiene mayor riesgo.'},
            {'id': '005', 'monto': 250000, 'plazo': 180, 'propósito': 'Compra de Terreno', 'cliente': {'nombre': 'Carlos Mendoza', 'dni': '87654321', 'score': 920}, 'prediccion': 'Riesgo Bajo', 'sugerencia': 'Perfil de muy bajo riesgo.'},
            {'id': '006', 'monto': 15000, 'plazo': 36, 'propósito': 'Estudios de Maestría', 'cliente': {'nombre': 'María Fernández', 'dni': '71234567', 'score': 710}, 'prediccion': 'Riesgo Bajo', 'sugerencia': ''}
        ]
        
        clientes_base = []
        for data in datos_especificos:
            cliente_info = data['cliente']
            nombre_partes = cliente_info['nombre'].split(' ')
            username = cliente_info['nombre'].replace(' ', '').lower()
            user_obj, _ = User.objects.get_or_create(
                username=username,
                defaults={'first_name': nombre_partes[0], 'last_name': ' '.join(nombre_partes[1:]), 'email': f"{username}@example.com", 'dni': cliente_info['dni'], 'role': 'cliente'}
            )
            user_obj.set_password('password123')
            user_obj.save()
            clientes_base.append(user_obj)
            
            Application.objects.create(
                client=user_obj, amount=Decimal(data['monto']), term_months=data['plazo'],
                purpose=data['propósito'], status='pendiente', credit_score=cliente_info['score'],
                evaluator_comments=f"Clasificación IA: {data['prediccion']}. Sugerencia: {data['sugerencia']}"
            )
        self.stdout.write(self.style.SUCCESS(f'Se crearon {len(datos_especificos)} usuarios y solicitudes específicas.'))

        # --- 4. CREACIÓN MASIVA DE CLIENTES Y SOLICITUDES ALEATORIAS ---
        self.stdout.write('Paso 4/5: Creando 200 clientes aleatorios y sus solicitudes...')
        clientes_adicionales = []
        for i in range(200):
            nombre = random.choice(NOMBRES)
            apellido = random.choice(APELLIDOS)
            username = f"{nombre.lower()}{apellido.lower()}{i}"
            cliente = User.objects.create_user(
                username=username, email=f"{username}@example.com",
                password='password123', role='cliente',
                first_name=nombre, last_name=apellido, dni=str(random.randint(10000000, 99999999))
            )
            clientes_adicionales.append(cliente)
        
        todos_los_clientes = clientes_base + clientes_adicionales
        status_options = ['pendiente', 'en_revision', 'aprobada', 'rechazada', 'desembolsada', 'cancelada']
        purpose_options = ['Compra de Vehículo', 'Capital de Trabajo', 'Mejora de Vivienda', 'Estudios', 'Consolidación de Deuda', 'Viaje', 'Salud', 'Tecnología']
        
        solicitudes_creadas = 0
        for cliente in todos_los_clientes:
            num_solicitudes = random.randint(1, 8)
            for _ in range(num_solicitudes):
                status_elegido = random.choices(status_options, weights=[20, 15, 30, 15, 15, 5], k=1)[0]
                fecha_solicitud = timezone.now() - timedelta(days=random.randint(0, 730))
                
                Application.objects.create(
                    client=cliente,
                    amount=Decimal(random.randrange(1000, 200000, 500)),
                    term_months=random.choice([12, 24, 36, 48, 60, 72, 84, 120]),
                    purpose=random.choice(purpose_options),
                    status=status_elegido,
                    application_date=fecha_solicitud,
                    credit_score=random.randint(300, 950) if random.random() > 0.15 else None,
                    evaluator_comments=random.choice(COMENTARIOS_EJEMPLO) if status_elegido not in ['pendiente', 'cancelada'] else ''
                )
                solicitudes_creadas += 1
        self.stdout.write(self.style.SUCCESS(f'Se crearon {len(clientes_adicionales)} clientes y {solicitudes_creadas} solicitudes aleatorias.'))

        # --- 5. RESUMEN FINAL ---
        total_users = User.objects.count()
        total_apps = Application.objects.count()
        self.stdout.write(self.style.SUCCESS(f'\n--- PROCESO FINALIZADO ---'))
        self.stdout.write(f'Total de Usuarios en la BD: {total_users} (1 Admin, 5 Evaluadores, {len(todos_los_clientes)} Clientes)')
        self.stdout.write(f'Total de Solicitudes en la BD: {total_apps}')
