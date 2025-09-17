# Makefile for ft_transcendence project

# Directories to persist data
PERSIST_DIRS = persist/sqlite persist/avatars
GET_IP := $(shell node get_ip.js 2>/dev/null || echo 'localhost')


all: up

init-dirs:
	@mkdir -p $(PERSIST_DIRS)
	
build: init-dirs
	@echo  "Starting with IP: $(GET_IP)"
	HOST_IP=$(GET_IP) docker-compose build

up: init-dirs
	HOST_IP=$(GET_IP) docker-compose up --build -d

clean:
	docker-compose down --remove-orphans
	docker-compose rm -f

fclean: clean
	docker-compose down -v
	docker system prune -af --volumes
	docker builder prune -af
	rm -rf node_modules

down:
	docker-compose down

restart: down up

logs:
	docker-compose logs -f

re: fclean all

.PHONY: re