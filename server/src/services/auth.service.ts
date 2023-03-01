import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ERROR_MESSAGE } from 'src/common/error-message';
import {
  AuthControllerInboundPort,
  DeserializeUserInboundInputDto,
  DeserializeUserInboundOutputDto,
  RegisterInboundInputDto,
  RegisterInboundOutputDto,
  SerializeUserInboundInputDto,
  SerializeUserInboundOutputDto,
  ValidateUserForGoogleInboundInputDto,
  ValidateUserForGoogleInboundOutputDto,
  ValidateUserInboundInputDto,
  ValidateUserInboundOutputDto,
} from 'src/inbound-ports/auth/auth-controller.inbound-port';
import {
  UserRepositoryOutboundPort,
  USER_REPOSITORY_OUTBOUND_PORT,
} from 'src/outbound-ports/user/user-repository.outbound-port';
import { compare, hash } from 'bcrypt';
import {
  RedisRepositoryOutboundPort,
  REDIS_REPOSITORY_OUTBOUND_PORT,
} from 'src/cache/redis/redis-repository.outbound-port';
import {
  ConfigServiceOutboundPort,
  CONFIG_SERVICE_OUTBOUND_PORT,
} from 'src/config/config-service.outbound-port';

@Injectable()
export class AuthService implements AuthControllerInboundPort {
  constructor(
    @Inject(USER_REPOSITORY_OUTBOUND_PORT)
    private readonly userRepositoryOutboundPort: UserRepositoryOutboundPort,

    @Inject(REDIS_REPOSITORY_OUTBOUND_PORT)
    private readonly redisRepositoryOutboundPort: RedisRepositoryOutboundPort,

    @Inject(CONFIG_SERVICE_OUTBOUND_PORT)
    private readonly configServiceOutboundPort: ConfigServiceOutboundPort,
  ) {}

  async validateUser(
    params: ValidateUserInboundInputDto,
  ): Promise<ValidateUserInboundOutputDto> {
    const user = await this.userRepositoryOutboundPort.findUserForLogIn({
      email: params.email,
    });

    if (!user) {
      throw new BadRequestException(ERROR_MESSAGE.FAIL_TO_FIND_EMAIL);
    }

    // verify password
    const isPasswordMatch = await compare(params.password, user.password);

    if (!isPasswordMatch) {
      throw new BadRequestException(ERROR_MESSAGE.FAIL_TO_LOGIN);
    }

    return {
      id: user.id,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      deletedAt: user.deletedAt,
      email: user.email,
      googleId: user.googleId,
    };
  }

  async serializeUser(
    params: SerializeUserInboundInputDto,
  ): Promise<SerializeUserInboundOutputDto> {
    await this.redisRepositoryOutboundPort.set({
      key: params.user,
      value: params.date,
      ttl: params.ttl,
    });
  }

  async deserializeUser(
    params: DeserializeUserInboundInputDto,
  ): Promise<DeserializeUserInboundOutputDto> {
    return await this.redisRepositoryOutboundPort.get({
      key: params.user,
    });
  }

  async register(
    params: RegisterInboundInputDto,
  ): Promise<RegisterInboundOutputDto> {
    const hashedPassword = await hash(
      params.password,
      await this.configServiceOutboundPort.getSaltForHash(),
    );
    const existedUser = await this.userRepositoryOutboundPort.findUserByEmail({
      email: params.email,
    });

    if (existedUser) {
      throw new BadRequestException(ERROR_MESSAGE.FAIL_TO_REGISTER_EMAIL);
    }

    const user = await this.userRepositoryOutboundPort.saveUser({
      email: params.email,
      hashedPassword: hashedPassword,
    });

    if (!user) {
      throw new BadRequestException(ERROR_MESSAGE.FAIL_TO_CREATE_USER);
    }
  }

  async validateUserForGoogle(
    params: ValidateUserForGoogleInboundInputDto,
  ): Promise<ValidateUserForGoogleInboundOutputDto> {
    const user = params;

    if (!user) {
      throw new BadRequestException(ERROR_MESSAGE.FAIL_TO_GOOGLE_LOGIN);
    }

    // providerId로 user가 존재하는지 여부 확인
    const existedUser =
      await this.userRepositoryOutboundPort.findUserByGoogleId({
        googleId: user.id,
      });

    // user가 존재하지 않으면, DB에 register하기
    if (!existedUser) {
      const registerUser = await this.userRepositoryOutboundPort.saveGoogleUser(
        {
          googleId: user.id,
          email: user.email,
        },
      );

      if (!registerUser) {
        throw new BadRequestException(ERROR_MESSAGE.FAIL_TO_CREATE_USER);
      }

      return { googleId: registerUser.googleId };
    }

    return { googleId: existedUser.googleId };
  }
}
