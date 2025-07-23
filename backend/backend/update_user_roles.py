import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()

from users.models import User

def update_user_roles():
    users = User.objects.all()
    updated = 0
    for user in users:
        if not user.role:
            user.role = 'cliente'
            user.save()
            updated += 1
    print(f"Usuarios actualizados: {updated}")

if __name__ == "__main__":
    update_user_roles() 